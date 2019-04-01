const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const Ajv = require('ajv')
const logger = require('../logger').child({category: 'crawler', dataset: 'posts'})
const db = require('../dbs/profile-data-db')
const crawler = require('./index')
const siteDescriptions = require('./site-descriptions')
const {doCrawl, doCheckpoint, emitProgressEvent, getMatchingChangesInOrder, generateTimeFilename, ensureDirectory, toOrigin} = require('./util')
const postSchema = require('./json-schemas/post')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/post'
const JSON_PATH_REGEX = /^\/data\/feed\/([^/]+)\.json$/i

// typedefs
// =

/**
 * @typedef {import('../dat/library').InternalDatArchive} InternalDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef { import("./site-descriptions").SiteDescription } SiteDescription
 *
 * @typedef {Object} Post
 * @prop {string} pathname
 * @prop {Object} content
 * @prop {string} content.body
 * @prop {number} crawledAt
 * @prop {number} createdAt
 * @prop {number} updatedAt
 * @prop {SiteDescription} author
 */

// globals
// =

const events = new Events()
const ajv = (new Ajv())
const validatePost = ajv.compile(postSchema)
const validatePostContent = ajv.compile(postSchema.properties.content)

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for posts.
 *
 * @param {InternalDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_posts', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling posts', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_posts WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_posts', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed posts
    var changedPosts = getMatchingChangesInOrder(changes, JSON_PATH_REGEX)
    if (changedPosts.length) {
      logger.verbose('Collected new/changed post files', {details: {url: archive.url, changedPosts: changedPosts.map(p => p.name)}})
    } else {
      logger.debug('No new post-files found', {details: {url: archive.url}})
    }
    emitProgressEvent(archive.url, 'crawl_posts', 0, changedPosts.length)

    // read and apply each post in order
    var progress = 0
    for (let changedPost of changedPosts) {
      // TODO Currently the crawler will abort reading the feed if any post fails to load
      //      this means that a single unreachable file can stop the forward progress of post indexing
      //      to solve this, we need to find a way to tolerate unreachable post-files without losing our ability to efficiently detect new posts
      //      -prf
      if (changedPost.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_posts WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedPost.name])
        events.emit('post-removed', archive.url)
      } else {
        // read
        let postString
        try {
          postString = await archive.pda.readFile(changedPost.name, 'utf8')
        } catch (err) {
          logger.warn('Failed to read post file, aborting', {details: {url: archive.url, name: changedPost.name, err}})
          return // abort indexing
        }

        // parse and validate
        let post
        try {
          post = JSON.parse(postString)
          let valid = validatePost(post)
          if (!valid) throw ajv.errorsText(validatePost.errors)
        } catch (err) {
          logger.warn('Failed to parse post file, skipping', {details: {url: archive.url, name: changedPost.name, err}})
          continue // skip
        }

        // massage the post
        post.createdAt = Number(new Date(post.createdAt))
        post.updatedAt = Number(new Date(post.updatedAt))
        if (isNaN(post.updatedAt)) post.updatedAt = 0 // optional

        // upsert
        let existingPost = await getPost(joinPath(archive.url, changedPost.name))
        if (existingPost) {
          await db.run(`
            UPDATE crawl_posts
              SET crawledAt = ?, body = ?, createdAt = ?, updatedAt = ?
              WHERE crawlSourceId = ? AND pathname = ?
          `, [Date.now(), post.content.body, post.createdAt, post.updatedAt, crawlSource.id, changedPost.name])
          events.emit('post-updated', archive.url)
        } else {
          await db.run(`
            INSERT INTO crawl_posts (crawlSourceId, pathname, crawledAt, body, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?)
          `, [crawlSource.id, changedPost.name, Date.now(), post.content.body, post.createdAt, post.updatedAt])
          events.emit('post-added', archive.url)
        }
      }

      // checkpoint our progress
      logger.silly(`Finished crawling posts`, {details: {url: archive.url}})
      await doCheckpoint('crawl_posts', TABLE_VERSION, crawlSource, changedPost.version)
      emitProgressEvent(archive.url, 'crawl_posts', ++progress, changedPosts.length)
    }
  })
}

/**
 * @description
 * List crawled posts.
 *
  * @param {Object} [opts]
  * @param {Object} [opts.filters]
  * @param {string|string[]} [opts.filters.authors]
  * @param {number} [opts.offset=0]
  * @param {number} [opts.limit]
  * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Post>>}
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
    SELECT crawl_posts.*, src.url AS crawlSourceUrl FROM crawl_posts
      INNER JOIN crawl_sources src ON src.id = crawl_posts.crawlSourceId
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
  return Promise.all(rows.map(massagePostRow))
}

/**
 * @description
 * Get crawled post.
 *
 * @param {string} url - The URL of the post
 * @returns {Promise<Post>}
 */
const getPost = exports.getPost = async function (url) {
  // validate & parse params
  var urlParsed
  if (url) {
    try { urlParsed = new URL(url) }
    catch (e) { throw new Error('Invalid URL: ' + url) }
  }

  // execute query
  return await massagePostRow(await db.get(`
    SELECT
        crawl_posts.*, src.url AS crawlSourceUrl
      FROM crawl_posts
      INNER JOIN crawl_sources src
        ON src.id = crawl_posts.crawlSourceId
        AND src.url = ?
      WHERE
        crawl_posts.pathname = ?
  `, [`${urlParsed.protocol}//${urlParsed.hostname}`, urlParsed.pathname]))
}

/**
 * @description
 * Create a new post.
 *
 * @param {InternalDatArchive} archive - where to write the post to.
 * @param {Object} content
 * @param {string} content.body
 * @returns {Promise<string>} url
 */
exports.addPost = async function (archive, content) {
  var valid = validatePostContent(content)
  if (!valid) throw ajv.errorsText(validatePostContent.errors)

  var filename = generateTimeFilename()
  var filepath = `/data/feed/${filename}.json`
  await ensureDirectory(archive, '/data')
  await ensureDirectory(archive, '/data/feed')
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
 * Update the content of an existing post.
 *
 * @param {InternalDatArchive} archive - where to write the post to.
 * @param {string} pathname - the pathname of the post.
 * @param {Object} content
 * @param {string} content.body
 * @returns {Promise<void>}
 */
exports.editPost = async function (archive, pathname, content) {
  var valid = validatePostContent(content)
  if (!valid) throw ajv.errorsText(validatePostContent.errors)
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
 * Delete an existing post
 *
 * @param {InternalDatArchive} archive - where to write the post to.
 * @param {string} pathname - the pathname of the post.
 * @returns {Promise<void>}
 */
exports.deletePost = async function (archive, pathname) {
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
 * @returns {Promise<Post>}
 */
async function massagePostRow (row) {
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
      body: row.body
    },
    crawledAt: row.crawledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
