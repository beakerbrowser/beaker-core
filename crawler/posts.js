const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const db = require('../dbs/profile-data-db')
const crawler = require('./index')
const {doCrawl, doCheckpoint, generateTimeFilename} = require('./util')
const debug = require('../lib/debug-logger').debugLogger('crawler')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/post'
const JSON_PATH_REGEX = /^\/data\/posts\/([^/]+)\.json$/i

// globals
// =

var events = new Events()

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_posts', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    console.log('Crawling posts for', archive.url, {changes, resetRequired})
    if (resetRequired) {
      // reset all data
      await db.run(`
        DELETE FROM crawl_posts WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_posts', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed posts
    var changedPosts = [] // order matters, must be oldest to newest
    changes.forEach(c => {
      if (JSON_PATH_REGEX.test(c.name)) {
        let i = changedPosts.findIndex(c2 => c2.name === c.name)
        if (i !== -1) {
          changedPosts.splice(i, 1) // remove from old position
        }
        changedPosts.push(c)
      }
    })
    console.log('collected changed posts', changedPosts)

    // read and apply each post in order
    for (let changedPost of changedPosts) {
      // TODO Currently the crawler will abort reading the feed if any post fails to load
      //      this means that a single bad or unreachable file can stop the forward progress of post indexing
      //      to solve this, we need to find a way to tolerate bad post-files without losing our ability to efficiently detect new posts
      //      -prf
      if (changedPost.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_posts WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedPost.name])
        events.emit('post-removed', archive.url)
      } else {
        // read and validate
        let post
        try {
          post = JSON.parse(await archive.pda.readFile(changedPost.name, 'utf8'))
          assert(typeof post === 'object', 'File be an object')
          assert(post.type === 'unwalled.garden/post', 'JSON type must be unwalled.garden/post')
          assert(typeof post.content === 'string', 'JSON content must be a string')
          assert(typeof post.createdAt === 'string', 'JSON createdAt must be a date-time')
          assert(!isNaN(Number(new Date(post.createdAt))), 'JSON createdAt must be a date-time')
        } catch (err) {
          debug('Failed to read post file', {url: archive.url, name: changedPost.name, err})
          return // abort indexing
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

        // checkpoint our progress
        await doCheckpoint('crawl_posts', TABLE_VERSION, crawlSource, changedPost.version)
      }
    }
  })
}

exports.list = async function ({offset, limit, reverse, author, authors} = {}) {
  // validate & parse params
  assert(!offset || typeof offset === 'number', 'Offset must be a number')
  assert(!limit || typeof limit === 'number', 'Limit must be a number')
  assert(!reverse || typeof reverse === 'boolean', 'Reverse must be a boolean')
  assert(!author || typeof author === 'string', 'Author must be a string')
  assert(!authors || !Array.isArray(author), 'Authors must be an array of strings')

  if (author) {
    try { author = toOrigin(author) }
    catch (e) { throw new Error('Author must be a valid URL') }
  }
  if (authors) {
    try { authors = authors.map(toOrigin) }
    catch (e) { throw new Error('Authors array must contain valid URLs') }
  }

  // build query
  var query = `
    SELECT crawl_posts.*, src.url AS crawlSourceUrl FROM crawl_posts
      INNER JOIN crawl_sources src ON src.id = crawl_posts.crawlSourceId
  `
  var values = []
  if (author) {
    query += ` WHERE src.url = ?`
    values.push(author)
  } else if (authors) {
    let op = 'WHERE'
    for (let author of authors) {
      query += ` ${op} src.url = ?`
      op = 'OR'
      values.push(author)
    }
  }
  if (offset) {
    query += ` OFFSET ?`
    values.push(offset)
  }
  if (limit) {
    query += ` LIMIT ?`
    values.push(limit)
  }
  query += ` ORDER BY createdAt`
  if (reverse) {
    query += ` DESC`
  }

  // execute query
  return (await db.all(query, values)).map(massagePostRow)
}

const get = exports.get = async function (url, pathname = undefined) {
  // validate & parse params
  if (url) {
    try { url = new URL(url) }
    catch (e) { throw new Error('Failed to parse post URL: ' + url) }
  }
  pathname = pathname || url.pathname

  // execute query
  return massagePostRow(await db.get(`
    SELECT
        crawl_posts.*, src.url AS crawlSourceUrl
      FROM crawl_posts
      INNER JOIN crawl_sources src
        ON src.id = crawl_posts.crawlSourceId
        AND src.url = ?
      WHERE
        crawl_posts.pathname = ?
  `, [url.origin, pathname]))
}

exports.create = async function (archive, {content} = {}) {
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

exports.edit = async function (archive, pathname, {content} = {}) {
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

exports.delete = async function (archive, pathname) {
  assert(typeof pathname === 'string', 'Delete() must be provided a valid URL string')
  await archive.pda.unlink(pathname)
  await crawler.crawlSite(archive)
}

// internal methods
// =

function toOrigin (url) {
  url = new URL(url)
  return url.protocol + '//' + url.hostname
}

async function ensureDirectory (archive, pathname) {
  try { await archive.pda.mkdir(pathname) }
  catch (e) { /* ignore */ }
}

function massagePostRow (row) {
  if (!row) return null
  row.author = {url: row.crawlSourceUrl}
  delete row.crawlSourceUrl
  delete row.crawlSourceId
  return row
}
