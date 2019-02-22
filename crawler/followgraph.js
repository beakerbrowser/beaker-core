const assert = require('assert')
const _difference = require('lodash.difference')
const Events = require('events')
const {URL} = require('url')
const Ajv = require('ajv')
const logger = require('../logger').child({category: 'crawler', dataset: 'followgraph'})
const lock = require('../lib/lock')
const db = require('../dbs/profile-data-db')
const crawler = require('./index')
const siteDescriptions = require('./site-descriptions')
const {doCrawl, doCheckpoint, emitProgressEvent} = require('./util')
const followsSchema = require('./json-schemas/follows')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/follows'
const JSON_PATH = '/data/follows.json'

// typedefs
// =

/**
 * @typedef {import('../dat/library').InternalDatArchive} InternalDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef {import('./site-descriptions').SiteDescription} SiteDescription
 */

// globals
// =

const events = new Events()
const ajv = (new Ajv())
const validateFollows = ajv.compile(followsSchema)

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for follows.
 *
 * @param {InternalDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise<void>}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_followgraph', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling follows', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_followgraph WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_followgraph', TABLE_VERSION, crawlSource, 0)
    }

    // did follows.json change?
    var change = changes.find(c => c.name === JSON_PATH)
    if (!change) {
      logger.debug('No change detected to follows record', {details: {url: archive.url}})
      if (changes.length) {
        await doCheckpoint('crawl_followgraph', TABLE_VERSION, crawlSource, changes[changes.length - 1].version)
      }
      return
    }

    logger.verbose('Change detected to follows record', {details: {url: archive.url}})
    emitProgressEvent(archive.url, 'crawl_followgraph', 0, 1)

    // read and validate
    try {
      var followsJson = await readFollowsFile(archive)
    } catch (err) {
      logger.warn('Failed to read follows file', {details: {url: archive.url, err}})
      return
    }

    // diff against the current follows
    var currentFollows = /** @type string[] */(await listFollows(archive.url))
    var newFollows = followsJson.urls
    var adds = _difference(newFollows, currentFollows)
    var removes = _difference(currentFollows, newFollows)
    logger.silly(`Adding ${adds.length} follows and removing ${removes.length} follows`, {details: {url: archive.url}})

    // write updates
    for (let add of adds) {
      try {
        await db.run(`
          INSERT INTO crawl_followgraph (crawlSourceId, destUrl, crawledAt) VALUES (?, ?, ?)
        `, [crawlSource.id, add, Date.now()])
      } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT') {
          // uniqueness constraint probably failed, which means we got a duplicate somehow
          // dont worry about it
          logger.warn('Attempted to insert duplicate followgraph record', {details: {url: archive.url, add}})
        } else {
          throw e
        }
      }
      if (!supressEvents) {
        events.emit('follow-added', archive.url, add)
      }
    }
    for (let remove of removes) {
      await db.run(`
        DELETE FROM crawl_followgraph WHERE crawlSourceId = ? AND destUrl = ?
      `, [crawlSource.id, remove])
      if (supressEvents) {
        events.emit('follow-removed', archive.url, remove)
      }
    }

    // write checkpoint as success
    logger.silly(`Finished crawling follows`, {details: {url: archive.url}})
    await doCheckpoint('crawl_followgraph', TABLE_VERSION, crawlSource, changes[changes.length - 1].version)
    emitProgressEvent(archive.url, 'crawl_followgraph', 1, 1)
  })
}

/**
 * @description
 * List sites that follow subject.
 *
 * @param {string} subject - (URL)
 * @param {Object} [opts]
 * @param {string} [opts.followedBy] - (URL) filter results to those followed by the site specified with this param. Causes .followsUser boolean to be set.
 * @param {boolean} [opts.includeDesc] - output a site description instead of a simple URL.
 * @param {boolean} [opts.includeFollowers] - include .followedBy in the result. Requires includeDesc to be true.
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 * @returns {Promise<Array<string|SiteDescription>>}
 */
const listFollowers = exports.listFollowers = async function (subject, {followedBy, includeDesc, includeFollowers, offset, limit} = {}) {
  offset = offset || 0
  limit = limit || -1

  var rows
  if (followedBy) {
    rows = await db.all(`
      SELECT cs.url FROM crawl_followgraph fg
        INNER JOIN crawl_sources cs ON cs.id = fg.crawlSourceId
        WHERE fg.destUrl = ?
          AND (cs.url = ? OR cs.url IN (
            SELECT destUrl as url FROM crawl_followgraph
              INNER JOIN crawl_sources ON crawl_sources.id = crawl_followgraph.crawlSourceId
              WHERE crawl_sources.url = ?
          ))
        LIMIT ?
        OFFSET ?
    `, [subject, followedBy, followedBy, limit, offset])
  } else {
    rows = await db.all(`
      SELECT f.url
        FROM crawl_sources f
        INNER JOIN crawl_followgraph
          ON crawl_followgraph.crawlSourceId = f.id
          AND crawl_followgraph.destUrl = ?
        LIMIT ?
        OFFSET ?
    `, [subject, limit, offset])
  }
  if (!includeDesc) {
    return rows.map(row => toOrigin(row.url))
  }
  return Promise.all(rows.map(async (row) => {
    var url = toOrigin(row.url)
    var desc = await siteDescriptions.getBest({subject: url})
    desc.url = url
    if (followedBy) {
      desc.followsUser = await isAFollowingB(url, followedBy)
    }
    if (includeFollowers) {
      desc.followedBy = /** @type Array<SiteDescription> */ (await listFollowers(url, {followedBy, includeDesc: true}))
    }
    return desc
  }))
}

/**
 * @description
 * List sites that subject follows.
 *
 * @param {string} subject - (URL)
 * @param {Object} [opts]
 * @param {string} [opts.followedBy] - (URL) filter results to those followed by the site specified with this param. Causes .followsUser boolean to be set.
 * @param {boolean} [opts.includeDesc] - output a site description instead of a simple URL.
 * @param {boolean} [opts.includeFollowers] - include .followedBy in the result. Requires includeDesc to be true.
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 * @returns {Promise<Array<SiteDescription | string>>}
 */
const listFollows = exports.listFollows = async function (subject, {followedBy, includeDesc, includeFollowers, offset, limit} = {}) {
  offset = offset || 0
  limit = limit || -1

  var rows = await db.all(`
    SELECT crawl_followgraph.destUrl
      FROM crawl_followgraph
      INNER JOIN crawl_sources
        ON crawl_followgraph.crawlSourceId = crawl_sources.id
        AND crawl_sources.url = ?
      LIMIT ?
      OFFSET ?
  `, [subject, limit, offset])
  if (!includeDesc) {
    return rows.map(row => toOrigin(row.destUrl))
  }
  return Promise.all(rows.map(async (row) => {
    var url = toOrigin(row.destUrl)
    var desc = /** @type SiteDescription */ ((await siteDescriptions.getBest({subject: url})) || {})
    desc.url = url
    if (followedBy) {
      desc.followsUser = await isAFollowingB(url, followedBy)
    }
    if (includeFollowers) {
      desc.followedBy = /** @type Array<SiteDescription> */ (await listFollowers(url, {followedBy, includeDesc: true}))
    }
    return desc
  }))
}

/**
 * @description
 * List sites that are followed by sites that the subject follows.
 *
 * @param {string} subject - (URL)
 * @param {Object} [opts]
 * @param {string} [opts.followedBy] - (URL) filter results to those followed by the site specified with this param. Causes .followsUser boolean to be set.
 * @returns {Promise<Array<SiteDescription>>}
 */
const listFoaFs = exports.listFoaFs = async function (subject, {followedBy} = {}) {
  var foafs = []
  // list URLs followed by subject
  var follows = /** @type Array<SiteDescription> */ (await listFollows(subject, {followedBy, includeDesc: true}))
  for (let follow of follows) {
    // list follows of this follow
    for (let foaf of /** @type Array<SiteDescription> */ (await listFollows(follow.url, {followedBy, includeDesc: true}))) {
      // ignore if followed by subject or is subject
      if (foaf.url === subject) continue
      if (follows.find(v => v.url === foaf.url)) continue
      // merge into list
      let existingFoaF = foafs.find(v => v.url === foaf.url)
      if (existingFoaF) {
        existingFoaF.followedBy.push(follow)
      } else {
        foaf.followedBy = [follow]
        foafs.push(foaf)
      }
    }
  }
  return foafs
}

/**
 * @description
 * Check for the existence of an individual follow.
 *
 * @param {string} a - (URL) the site being queried.
 * @param {string} b - (URL) does a follow this site?
 * @returns {Promise<boolean>}
 */
const isAFollowingB = exports.isAFollowingB = async function (a, b) {
  a = toOrigin(a)
  b = toOrigin(b)
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

/**
 * @description
 * Add a follow to the given archive.
 *
 * @param {InternalDatArchive} archive
 * @param {string} followUrl
 * @returns {Promise<void>}
 */
exports.follow = async function (archive, followUrl) {
  // normalize followUrl
  followUrl = toOrigin(followUrl)
  assert(typeof followUrl === 'string', 'Follow() must be given a valid URL')

  // write new follows.json
  await updateFollowsFile(archive, followsJson => {
    if (!followsJson.urls.find(v => v === followUrl)) {
      followsJson.urls.push(followUrl)
    }
  })

  // capture site description
  /* dont await */siteDescriptions.capture(archive, followUrl)
}

/**
 * @description
 * Remove a follow from the given archive.
 *
 * @param {InternalDatArchive} archive
 * @param {string} followUrl
 * @returns {Promise<void>}
 */
exports.unfollow = async function (archive, followUrl) {
  // normalize followUrl
  followUrl = toOrigin(followUrl)
  assert(typeof followUrl === 'string', 'Unfollow() must be given a valid URL')

  // write new follows.json
  await updateFollowsFile(archive, followsJson => {
    var i = followsJson.urls.findIndex(v => v === followUrl)
    if (i !== -1) {
      followsJson.urls.splice(i, 1)
    }
  })
}

// internal methods
// =

/**
 * @param {string} url
 * @returns {string}
 */
function toOrigin (url) {
  try {
    var urlParsed = new URL(url)
    return urlParsed.protocol + '//' + urlParsed.hostname
  } catch (e) {
    return null
  }
}

/**
 * @param {InternalDatArchive} archive
 * @returns {Promise<Object>}
 */
async function readFollowsFile (archive) {
  try {
    var followsJson = await archive.pda.readFile(JSON_PATH, 'utf8')
  } catch (e) {
    if (e.notFound) return {type: JSON_TYPE, urls: []} // empty default when not found
    throw e
  }
  followsJson = JSON.parse(followsJson)
  var valid = validateFollows(followsJson)
  if (!valid) throw ajv.errorsText(validateFollows.errors)
  return followsJson
}

/**
 * @param {InternalDatArchive} archive
 * @param {function(Object): void} updateFn
 * @returns {Promise<void>}
 */
async function updateFollowsFile (archive, updateFn) {
  var release = await lock('crawler:followgraph:' + archive.url)
  try {
    // read the follows file
    try {
      var followsJson = await readFollowsFile(archive)
    } catch (err) {
      if (err.notFound) {
        // create new
        followsJson = {
          type: JSON_TYPE,
          urls: []
        }
      } else {
        logger.warn('Failed to read follows file', {details: {url: archive.url, err}})
        throw err
      }
    }

    // apply update
    updateFn(followsJson)

    // write the follows file
    await archive.pda.writeFile(JSON_PATH, JSON.stringify(followsJson, null, 2), 'utf8')

    // trigger crawl now
    await crawler.crawlSite(archive)
  } finally {
    release()
  }
}
