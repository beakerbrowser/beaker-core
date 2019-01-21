const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const logger = require('../logger').child({category: 'crawler', dataset: 'posts'})
const db = require('../dbs/profile-data-db')
const crawler = require('./index')
const siteDescriptions = require('./site-descriptions')
const {doCrawl, doCheckpoint, emitProgressEvent, getMatchingChangesInOrder, generateTimeFilename} = require('./util')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/post'
const JSON_PATH_REGEX = /^\/data\/posts\/([^/]+)\.json$/i

// typedefs
// =

/**
 * @typedef {import('../dat/library').InternalDatArchive} InternalDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef { import("./site-descriptions").SiteDescription } SiteDescription
 *
 * @typedef {Object} Post
 * @prop {string} pathname
 * @prop {string} content
 * @prop {number} crawledAt
 * @prop {number} createdAt
 * @prop {number} updatedAt
 * @prop {SiteDescription} author
 */

// globals
// =

var events = new Events()

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
      logger.debug('Collected new/changed post files', {details: {url: archive.url, changedPosts: changedPosts.map(p => p.name)}})
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
          assert(typeof post === 'object', 'File be an object')
          assert(post.type === 'unwalled.garden/post', 'JSON type must be unwalled.garden/post')
          assert(typeof post.content === 'string', 'JSON content must be a string')
          assert(typeof post.createdAt === 'string', 'JSON createdAt must be a date-time')
          assert(!isNaN(Number(new Date(post.createdAt))), 'JSON createdAt must be a date-time')
        } catch (err) {
          logger.warn('Failed to parse post file, skipping', {details: {url: archive.url, name: changedPost.name, err}})
          continue // skip
        }

        // massage the post
        post.createdAt = Number(new Date(post.createdAt))
        post.updatedAt = Number(new Date(post.updatedAt))
        if (isNaN(post.updatedAt)) post.updatedAt = 0 // value is optional

        // upsert
        let existingPost = await get(archive.url, changedPost.name)
        if (existingPost) {
          await db.run(`
            UPDATE crawl_posts
              SET crawledAt = ?, content = ?, createdAt = ?, updatedAt = ?
              WHERE crawlSourceId = ? AND pathname = ?
          `, [Date.now(), post.content, post.createdAt, post.updatedAt, crawlSource.id, changedPost.name])
          events.emit('post-updated', archive.url)
        } else {
          await db.run(`
            INSERT INTO crawl_posts (crawlSourceId, pathname, crawledAt, content, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?)
          `, [crawlSource.id, changedPost.name, Date.now(), post.content, post.createdAt, post.updatedAt])
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
 * @param {string} [opts.author] - (URL) filter descriptions to those created by this author.
 * @param {Array<string>} [opts.authors] - (URL) filter descriptions to those created by these authors.
 * @param {number} [opts.offset]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Post>>}
 */
exports.list = async function ({offset, limit, reverse, author, authors} = {}) {
  // validate & parse params
  assert(!offset || typeof offset === 'number', 'Offset must be a number')
  assert(!limit || typeof limit === 'number', 'Limit must be a number')
  assert(!reverse || typeof reverse === 'boolean', 'Reverse must be a boolean')
  assert(!author || typeof author === 'string', 'Author must be a string')
  assert(!authors || (Array.isArray(authors) && authors.every(isString)), 'Authors must be an array of strings')

  if (author) {
    authors = authors || []
    authors.push(author)
  }
  if (authors) {
    try { authors = authors.map(toOrigin) }
    catch (e) { throw new Error('Author/authors must contain valid URLs') }
  }

  // build query
  var query = `
    SELECT crawl_posts.*, src.url AS crawlSourceUrl FROM crawl_posts
      INNER JOIN crawl_sources src ON src.id = crawl_posts.crawlSourceId
  `
  var values = []
  if (authors) {
    let op = 'WHERE'
    for (let a of authors) {
      query += ` ${op} src.url = ?`
      op = 'OR'
      values.push(a)
    }
  }
  query += ` ORDER BY createdAt`
  if (reverse) {
    query += ` DESC`
  }
  if (limit) {
    query += ` LIMIT ?`
    values.push(limit)
  }
  if (offset) {
    query += ` OFFSET ?`
    values.push(offset)
  }

  // execute query
  var rows = await db.all(query, values)
  return Promise.all(rows.map(massagePostRow))
}

/**
 * @description
 * Get crawled post.
 *
 * @param {string} url - The URL of the post or of the author (if pathname is provided).
 * @param {string} [pathname] - The pathname of the post.
 * @returns {Promise<Post>}
 */
const get = exports.get = async function (url, pathname = undefined) {
  // validate & parse params
  var urlParsed
  if (url) {
    try { urlParsed = new URL(url) }
    catch (e) { throw new Error('Failed to parse post URL: ' + url) }
  }
  pathname = pathname || urlParsed.pathname

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
  `, [urlParsed.origin, pathname]))
}

/**
 * @description
 * Create a new post.
 *
 * @param {InternalDatArchive} archive - where to write the post to.
 * @param {Object} post
 * @param {string} post.content
 * @returns {Promise}
 */
exports.create = async function (archive, {content}) {
  assert(typeof content === 'string', 'Create() must be provided a `content` string')
  var filename = generateTimeFilename()
  await ensureDirectory(archive, '/data')
  await ensureDirectory(archive, '/data/posts')
  await archive.pda.writeFile(`/data/posts/${filename}.json`, JSON.stringify({
    type: JSON_TYPE,
    content,
    createdAt: (new Date()).toISOString()
  }))
  await crawler.crawlSite(archive)
}

/**
 * @description
 * Update the content of an existing post.
 *
 * @param {InternalDatArchive} archive - where to write the post to.
 * @param {string} pathname - the pathname of the post.
 * @param {Object} post
 * @param {string} post.content
 * @returns {Promise}
 */
exports.edit = async function (archive, pathname, {content}) {
  assert(typeof pathname === 'string', 'Edit() must be provided a valid URL string')
  assert(typeof content === 'string', 'Edit() must be provided a `content` string')
  var oldJson = JSON.parse(await archive.pda.readFile(pathname))
  await archive.pda.writeFile(pathname, JSON.stringify({
    type: JSON_TYPE,
    content,
    createdAt: oldJson.createdAt,
    updatedAt: (new Date()).toISOString()
  }))
  await crawler.crawlSite(archive)
}

/**
 * @description
 * Delete an existing post
 *
 * @param {InternalDatArchive} archive - where to write the post to.
 * @param {string} pathname - the pathname of the post.
 * @returns {Promise}
 */
exports.delete = async function (archive, pathname) {
  assert(typeof pathname === 'string', 'Delete() must be provided a valid URL string')
  await archive.pda.unlink(pathname)
  await crawler.crawlSite(archive)
}

// internal methods
// =

/**
 * @param {string} v
 * @returns {boolean}
 */
function isString (v) {
  return typeof v === 'string'
}

/**
 * @param {string} url
 * @returns {string}
 */
function toOrigin (url) {
  var urlParsed = new URL(url)
  return urlParsed.protocol + '//' + urlParsed.hostname
}

/**
 * @param {InternalDatArchive} archive
 * @param {string} pathname
 * @returns {Promise}
 */
async function ensureDirectory (archive, pathname) {
  try { await archive.pda.mkdir(pathname) }
  catch (e) { /* ignore */ }
}

/**
 * @param {Object} row
 * @returns {Promise<Post>}
 */
async function massagePostRow (row) {
  if (!row) return null
  row.author = await siteDescriptions.getBest({subject: row.crawlSourceUrl})
  if (!row.author) row.author = {url: row.crawlSourceUrl}
  delete row.crawlSourceUrl
  delete row.crawlSourceId
  return row
}
