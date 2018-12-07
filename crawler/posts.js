const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const db = require('../dbs/profile-data-db')
const {doCrawl} = require('./util')

// constants
// =

const TABLE_VERSION = 1

// globals
// =

var events = new Events()

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

exports.crawlSite = async function (archive) {
  return doCrawl(archive, 'crawl_posts', TABLE_VERSION, async ({changes, resetRequired}) => {
    if (resetRequired) {
      // reset all data
      // TODO
    }

    // find files that need to be processed
    // TODO

    // process the files
    // TODO
    // events.emit('post-added', sourceUrl)
    // events.emit('post-updated', sourceUrl)
    // events.emit('post-removed', sourceUrl)
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

exports.get = async function (url, pathname = undefined) {
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
