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
  return doCrawl(archive, 'crawl_followgraph', TABLE_VERSION, async ({changes, resetRequired}) => {
    if (resetRequired) {
      // reset all data
      // TODO
    }

    // find files that need to be processed
    // TODO

    // process the files
    // TODO
    // events.emit('follow-added', sourceUrl, subjectUrl)
    // events.emit('follow-removed', sourceUrl, subjectUrl)
  })
}

// List urls of sites that follow subject
// - subject. String (URL).
// - returns Array<String>
exports.listFollowers = async function (subject) {
  var rows = await db.all(`
    SELECT crawl_sources.url
      FROM crawl_sources
      INNER JOIN crawl_followgraph
        ON crawl_followgraph.crawlSourceId = crawl_sources.id
        AND crawl_followgraph.destUrl = ?
  `, [subject])
  return rows.map(row => row.url)
}

// List urls of sites that subject follows
// - subject. String (URL).
// - returns Array<String>
exports.listFollows = async function (subject) {
  var rows = await db.all(`
    SELECT crawl_followgraph.destUrl
      FROM crawl_followgraph
      INNER JOIN crawl_sources
        ON crawl_followgraph.crawlSourceId = crawl_sources.id
        AND crawl_sources.url = ?
  `, [subject])
  return rows.map(row => row.destUrl)
}

// Check for the existence of an individual follow
// - a. String (URL), the site being queried.
// - b. String (URL), does a follow this site?
// - returns bool
exports.isAFollowingB = async function (a, b) {
  var res = await db.get(`
    SELECT crawl_sources.id
      FROM crawl_sources
      INNER JOIN crawl_followgraph
        ON crawl_followgraph.crawlSourceId = crawl_sources.id
        AND crawl_followgraph.destUrl = ?
      WHERE crawl_sources.url = ?
  `, [b, a])
  return !!res
}

exports.follow = function () {
  throw new Error('Not yet implemented')

  // update the user dat
  // TODO
}

exports.unfollow = function () {
  throw new Error('Not yet implemented')

  // update the user dat
  // TODO
}
