const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const db = require('../dbs/profile-data-db')
const {doCrawl} = require('./util')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/post'
const JSON_PATH_REGEX = /^\/data\/posts\/([^\/]+)\.json$/i

// globals
// =

var events = new Events()

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

exports.crawlSite = async function (archive, crawlSourceId) {
  return doCrawl(archive, 'crawl_posts', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    if (resetRequired) {
      // reset all data
      await db.run(`
        DELETE FROM crawl_posts WHERE crawlSourceId = ?
      `, [crawlSourceId])
      await doCheckpoint('crawl_posts', TABLE_VERSION, crawlSourceId, 0)
    }

    // collect changed posts
    var changedPosts = [] // order matters, must be oldest to newest
    changes.forEach(c => {
      if (JSON_PATH_REGEX.test(c.path)) {
        let i = changedPosts.findIndex(c2 => c2.path === c.path)
        if (i) {
          changedPosts.splice(i, 1) // remove from old position
        }
        changedPosts.push(c)
      }
    })

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
        `, [crawlSourceId, changedPost.path])
        events.emit('post-removed', archive.url)
      } else {
        // read and validate
        let post
        try {
          post = JSON.parse(await archive.pda.readFile(changedPost.path, 'utf8'))
          assert(typeof post === 'object', 'File be an object')
          assert(post.type === 'unwalled.garden/post', 'JSON type must be unwalled.garden/post')
          assert(typeof post.content === 'string', 'JSON content must be a string')
          assert(typeof post.createdAt === 'string', 'JSON createdAt must be a date-time')
          assert(!isNaN(Number(new Date(post.createdAt))), 'JSON createdAt must be a date-time')
        } catch (err) {
          debug('Failed to read post file', {url: archive.url, path: c.path, err})
          return // abort indexing
        }

        // massage the post
        post.createdAt = Number(new Date(post.createdAt))
        post.updatedAt = Number(new Date(post.updatedAt))
        if (isNaN(post.updatedAt)) post.updatedAt = 0 // value is optional

        // upsert
        let existingPost = await get(archive.url, c.path)
        if (existingPost) {
          await db.run(`
            UPDATE crawl_posts
              SET crawledAt = ?, content = ?, createdAt = ?, updatedAt = ?
              WHERE crawlSourceId = ? AND pathname = ?
          `, [Date.now(), post.content, post.createdAt, post.updatedAt, crawlSourceId, changedPost.path])
          events.emit('post-updated', archive.url)
        } else {
          await db.run(`
            INSERT INTO crawl_posts (crawlSourceId, pathname, crawledAt, content, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?)
          `, [crawlSourceId, changedPost.path, Date.now(), post.content, post.createdAt, post.updatedAt])
          events.emit('post-added', archive.url)
        }

        // checkpoint our progress
        await doCheckpoint('crawl_posts', TABLE_VERSION, crawlSourceId, changedPost.version)
      }
    }
  })
}

exports.list = async function ({offset, limit, reverse, author} = {}) {
  // validate & parse params
  assert(!offset || typeof offset === 'number', 'Offset must be a number')
  assert(!limit || typeof limit === 'number', 'Limit must be a number')
  assert(!reverse || typeof reverse === 'boolean', 'Reverse must be a boolean')
  assert(!author || typeof author === 'string', 'Author must be a string')
  if (author) {
    try { author = new URL(author) }
    catch (e) { throw new Error('Failed to parse author URL: ' + author) }
  }

  // build query
  var query = `SELECT crawl_posts.*, src.url AS crawlSourceUrl FROM crawl_posts`
  var values = []
  if (author) {
    query += ` INNER JOIN crawl_sources src ON src.url = ?`
    values.push(author.origin)
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
  return db.all(query, values)
}

const get = exports.get = async function (url, pathname = undefined) {
  // validate & parse params
  if (url) {
    try { url = new URL(url) }
    catch (e) { throw new Error('Failed to parse post URL: ' + url) }
  }
  pathname = pathname || url.pathname

  // execute query
  return db.get(`
    SELECT
        crawl_posts.*, src.url AS crawlSourceUrl
      FROM crawl_posts
      INNER JOIN crawl_sources src
        ON src.id = crawl_posts.crawlSourceId
        AND src.url = ?
      WHERE
        crawl_posts.pathname = ?
  `, [url.origin, pathname])
}

exports.create = async function () {
  throw new Error('Not yet implemented')

  // update the user dat
  // TODO
}

exports.edit = async function () {
  throw new Error('Not yet implemented')

  // update the user dat
  // TODO
}

exports.delete = async function () {
  throw new Error('Not yet implemented')

  // update the user dat
  // TODO
}
