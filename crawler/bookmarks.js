const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const Ajv = require('ajv')
const logger = require('../logger').child({category: 'crawler', dataset: 'bookmarks'})
const db = require('../dbs/profile-data-db')
const crawler = require('./index')
const siteDescriptions = require('./site-descriptions')
const {doCrawl, doCheckpoint, emitProgressEvent, getMatchingChangesInOrder, generateTimeFilename, ensureDirectory} = require('./util')
const bookmarkSchema = require('./json-schemas/bookmark')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/bookmark'
const JSON_PATH_REGEX = /^\/data\/bookmarks\/([^/]+)\.json$/i

// typedefs
// =

/**
 * @typedef {import('../dat/library').InternalDatArchive} InternalDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef { import("./site-descriptions").SiteDescription } SiteDescription
 *
 * @typedef {Object} Bookmark
 * @prop {string} pathname
 * @prop {Object} content
 * @prop {string} content.href
 * @prop {string} content.title
 * @prop {string?} content.description
 * @prop {string[]?} content.tags
 * @prop {number} crawledAt
 * @prop {number} createdAt
 * @prop {number} updatedAt
 * @prop {SiteDescription} author
 */

// globals
// =

const events = new Events()
const ajv = (new Ajv())
const validateBookmark = ajv.compile(bookmarkSchema)
const validateBookmarkContent = ajv.compile(bookmarkSchema.properties.content)

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for bookmarks.
 *
 * @param {InternalDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_bookmarks', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling bookmarks', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_bookmarks WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_bookmarks', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed bookmarks
    var changedBookmarks = getMatchingChangesInOrder(changes, JSON_PATH_REGEX)
    if (changedBookmarks.length) {
      logger.verbose('Collected new/changed bookmark files', {details: {url: archive.url, changedBookmarks: changedBookmarks.map(p => p.name)}})
    } else {
      logger.debug('No new bookmark-files found', {details: {url: archive.url}})
    }
    emitProgressEvent(archive.url, 'crawl_bookmarks', 0, changedBookmarks.length)

    // read and apply each bookmark in order
    var progress = 0
    for (let changedBookmark of changedBookmarks) {
      // TODO Currently the crawler will abort reading the bookmarks if any bookmark fails to load
      //      this means that a single unreachable file can stop the forward progress of bookmark indexing
      //      to solve this, we need to find a way to tolerate unreachable bookmark-files without losing our ability to efficiently detect new bookmarks
      //      -prf
      if (changedBookmark.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_bookmarks WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedBookmark.name])
        events.emit('bookmark-removed', archive.url)
      } else {
        // read
        let bookmarkString
        try {
          bookmarkString = await archive.pda.readFile(changedBookmark.name, 'utf8')
        } catch (err) {
          logger.warn('Failed to read bookmark file, aborting', {details: {url: archive.url, name: changedBookmark.name, err}})
          return // abort indexing
        }

        // parse and validate
        let bookmark
        try {
          bookmark = JSON.parse(bookmarkString)
          let valid = validateBookmark(bookmark)
          if (!valid) throw ajv.errorsText(validateBookmark.errors)
        } catch (err) {
          logger.warn('Failed to parse bookmark file, skipping', {details: {url: archive.url, name: changedBookmark.name, err}})
          continue // skip
        }

        // massage the bookmark
        bookmark.createdAt = Number(new Date(bookmark.createdAt))
        bookmark.updatedAt = Number(new Date(bookmark.updatedAt))
        if (isNaN(bookmark.updatedAt)) bookmark.updatedAt = 0 // optional
        if (!bookmark.content.description) bookmark.content.description = '' // optional
        if (!bookmark.content.tags) bookmark.content.tags = [] // optional
        bookmark.content.tags = bookmark.content.tags.join(' ')

        // upsert
        let existingBookmark = await getBookmark(joinPath(archive.url, changedBookmark.name))
        if (existingBookmark) {
          await db.run(`
            UPDATE crawl_bookmarks
              SET crawledAt = ?, href = ?, title = ?, description = ?, tags = ?, createdAt = ?, updatedAt = ?
              WHERE crawlSourceId = ? AND pathname = ?
          `, [Date.now(), bookmark.content.href, bookmark.content.title, bookmark.content.description, bookmark.content.tags, bookmark.createdAt, bookmark.updatedAt, crawlSource.id, changedBookmark.name])
          events.emit('bookmark-updated', archive.url)
        } else {
          await db.run(`
            INSERT INTO crawl_bookmarks (crawlSourceId, pathname, crawledAt, href, title, description, tags, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [crawlSource.id, changedBookmark.name, Date.now(), bookmark.content.href, bookmark.content.title, bookmark.content.description, bookmark.content.tags, bookmark.createdAt, bookmark.updatedAt])
          events.emit('bookmark-added', archive.url)
        }
      }

      // checkpoint our progress
      logger.silly(`Finished crawling bookmarks`, {details: {url: archive.url}})
      await doCheckpoint('crawl_bookmarks', TABLE_VERSION, crawlSource, changedBookmark.version)
      emitProgressEvent(archive.url, 'crawl_bookmarks', ++progress, changedBookmarks.length)
    }
  })
}

/**
 * @description
 * List crawled bookmarks.
 *
  * @param {Object} [opts]
  * @param {Object} [opts.filters]
  * @param {string|string[]} [opts.filters.authors]
  * @param {number} [opts.offset=0]
  * @param {number} [opts.limit]
  * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Bookmark>>}
 */
exports.query = async function (opts) {
  // validate & parse params
  if (opts && 'offset' in opts) assert(typeof opts.offset === 'number', 'Offset must be a number')
  if (opts && 'limit' in opts) assert(typeof opts.limit === 'number', 'Limit must be a number')
  if (opts && 'reverse' in opts) assert(typeof opts.reverse === 'boolean', 'Reverse must be a boolean')
  if (opts && opts.filters) {
    if ('authors' in opts.filters) {
      if (Array.isArray(opts.filters.authors)) {
        assert(opts.filters.authors.every(v => typeof v === 'string'), 'Authors filter must be a string or array of strings')
      } else {
        assert(typeof opts.filters.authors === 'string', 'Authors filter must be a string or array of strings')
        opts.filters.authors = [opts.filters.authors]
      }
      opts.filters.authors = opts.filters.authors.map(toAuthorOrigin)
    }
  }

  // build query
  var query = `
    SELECT crawl_bookmarks.*, src.url AS crawlSourceUrl FROM crawl_bookmarks
      INNER JOIN crawl_sources src ON src.id = crawl_bookmarks.crawlSourceId
  `
  var values = []
  if (opts && opts.filters && opts.filters.authors) {
    let op = 'WHERE'
    for (let a of opts.filters.authors) {
      query += ` ${op} src.url = ?`
      op = 'OR'
      values.push(a)
    }
  }
  query += ` ORDER BY createdAt`
  if (opts && opts.reverse) {
    query += ` DESC`
  }
  if (opts && opts.limit) {
    query += ` LIMIT ?`
    values.push(opts.limit)
  }
  if (opts && opts.offset) {
    query += ` OFFSET ?`
    values.push(opts.offset)
  }

  // execute query
  var rows = await db.all(query, values)
  return Promise.all(rows.map(massageBookmarkRow))
}

/**
 * @description
 * Get crawled bookmark.
 *
 * @param {string} url - The URL of the bookmark
 * @returns {Promise<Bookmark>}
 */
const getBookmark = exports.getBookmark = async function (url) {
  // validate & parse params
  var urlParsed
  if (url) {
    try { urlParsed = new URL(url) }
    catch (e) { throw new Error('Invalid URL: ' + url) }
  }

  // execute query
  return await massageBookmarkRow(await db.get(`
    SELECT
        crawl_bookmarks.*, src.url AS crawlSourceUrl
      FROM crawl_bookmarks
      INNER JOIN crawl_sources src
        ON src.id = crawl_bookmarks.crawlSourceId
        AND src.url = ?
      WHERE
        crawl_bookmarks.pathname = ?
  `, [`${urlParsed.protocol}//${urlParsed.hostname}`, urlParsed.pathname]))
}

/**
 * @description
 * Create a new bookmark.
 *
 * @param {InternalDatArchive} archive - where to write the bookmark to.
 * @param {Object} content
 * @param {string} content.href
 * @param {string} content.title
 * @param {string?} content.description
 * @param {string?|string[]?} content.tags
 * @returns {Promise<string>} url
 */
exports.addBookmark = async function (archive, content) {
  if (content && typeof content.tags === 'string') content.tags = content.tags.split(' ')
  var valid = validateBookmarkContent(content)
  if (!valid) throw ajv.errorsText(validateBookmarkContent.errors)

  var filename = generateTimeFilename()
  var filepath = `/data/bookmarks/${filename}.json`
  await ensureDirectory(archive, '/data')
  await ensureDirectory(archive, '/data/bookmarks')
  await archive.pda.writeFile(filepath, JSON.stringify({
    type: JSON_TYPE,
    content,
    createdAt: (new Date()).toISOString()
  }, null, 2))
  await crawler.crawlSite(archive)
  return archive.url + filepath
}

/**
 * @description
 * Update the content of an existing bookmark.
 *
 * @param {InternalDatArchive} archive - where to write the bookmark to.
 * @param {string} pathname - the pathname of the bookmark.
 * @param {Object} content
 * @param {string} content.href
 * @param {string} content.title
 * @param {string?} content.description
 * @param {string?|string[]?} content.tags
 * @returns {Promise<void>}
 */
exports.editBookmark = async function (archive, pathname, content) {
  if (content && typeof content.tags === 'string') content.tags = content.tags.split(' ')
  var valid = validateBookmarkContent(content)
  if (!valid) throw ajv.errorsText(validateBookmarkContent.errors)
  var oldJson = JSON.parse(await archive.pda.readFile(pathname))
  await archive.pda.writeFile(pathname, JSON.stringify({
    type: JSON_TYPE,
    content,
    createdAt: oldJson.createdAt,
    updatedAt: (new Date()).toISOString()
  }, null, 2))
  await crawler.crawlSite(archive)
}

/**
 * @description
 * Delete an existing bookmark
 *
 * @param {InternalDatArchive} archive - where to write the bookmark to.
 * @param {string} pathname - the pathname of the bookmark.
 * @returns {Promise<void>}
 */
exports.deleteBookmark = async function (archive, pathname) {
  assert(typeof pathname === 'string', 'Delete() must be provided a valid URL string')
  await archive.pda.unlink(pathname)
  await crawler.crawlSite(archive)
}

// internal methods
// =

/**
 * @param {string} url
 * @returns {string}
 */
function toAuthorOrigin (url) {
  try {
    var urlParsed = new URL(url)
    return urlParsed.protocol + '//' + urlParsed.hostname
  } catch (e) {
    throw new Error('Invalid URL: ' + url)
  }
}

/**
 * @param {string} origin
 * @param {string} pathname
 * @returns {string}
 */
function joinPath (origin, pathname) {
  if (origin.endsWith('/') && pathname.startsWith('/')) {
    return origin + pathname.slice(1)
  }
  if (!origin.endsWith('/') && !pathname.startsWith('/')) {
    return origin + '/' + pathname
  }
  return origin + pathname
}

/**
 * @param {Object} row
 * @returns {Promise<Bookmark>}
 */
async function massageBookmarkRow (row) {
  if (!row) return null
  var author = await siteDescriptions.getBest({subject: row.crawlSourceUrl})
  if (!author) {
    author = {
      url: row.crawlSourceUrl,
      title: '',
      description: '',
      type: [],
      thumbUrl: `${row.crawlSourceUrl}/thumb`,
      descAuthor: {url: null}
    }
  }
  return {
    pathname: row.pathname,
    author,
    content: {
      href: row.href,
      title: row.title,
      description: row.description,
      tags: row.tags.split(' ')
    },
    crawledAt: row.crawledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
