const assert = require('assert')
const _difference = require('lodash.difference')
const Events = require('events')
const {URL} = require('url')
const logger = require('../logger').child({category: 'crawler', dataset: 'published-sites'})
const lock = require('../lib/lock')
const db = require('../dbs/profile-data-db')
const crawler = require('./index')
const siteDescriptions = require('./site-descriptions')
const {doCrawl, doCheckpoint, emitProgressEvent} = require('./util')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/published-sites'
const JSON_PATH = '/data/sites.json'

// typedefs
// =

/**
 * @typedef {import('../dat/library').InternalDatArchive} InternalDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef {import('./site-descriptions').SiteDescription} SiteDescription
 *
 * @typedef {Object} PublishedSites
 * @prop {SiteDescription} author
 * @prop {SiteDescription[]} sites
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
 * Crawl the given site for published sites.
 *
 * @param {InternalDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise<void>}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_published_sites', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling published sites', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_published_sites WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_published_sites', TABLE_VERSION, crawlSource, 0)
    }

    // did sites.json change?
    var change = changes.find(c => c.name === JSON_PATH)
    if (!change) {
      logger.debug('No change detected to published-sites record', {details: {url: archive.url}})
      if (changes.length) {
        await doCheckpoint('crawl_published_sites', TABLE_VERSION, crawlSource, changes[changes.length - 1].version)
      }
      return
    }

    logger.verbose('Change detected to published-sites record', {details: {url: archive.url}})
    emitProgressEvent(archive.url, 'crawl_published_sites', 0, 1)

    // read and validate
    try {
      var sitesJson = await readSitesFile(archive)
    } catch (err) {
      logger.warn('Failed to read published-sites file', {details: {url: archive.url, err}})
      return
    }

    // diff against the current sites
    var currentPublishedSites = /** @type string[] */(await listPublishedSites(archive.url))
    var newSites = sitesJson.urls
    var adds = _difference(newSites, currentPublishedSites)
    var removes = _difference(currentPublishedSites, newSites)
    logger.silly(`Adding ${adds.length} sites and removing ${removes.length} sites`, {details: {url: archive.url}})

    // write updates
    for (let add of adds) {
      try {
        await db.run(`
          INSERT INTO crawl_published_sites (crawlSourceId, url, isConfirmedAuthor, crawledAt) VALUES (?, ?, ?, ?)
        `, [crawlSource.id, add, 0, Date.now()])
      } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT') {
          // uniqueness constraint probably failed, which means we got a duplicate somehow
          // dont worry about it
          logger.warn('Attempted to insert duplicate published-site record', {details: {url: archive.url, add}})
        } else {
          throw e
        }
      }
      if (!supressEvents) {
        events.emit('published-site-added', archive.url, add)
      }
    }
    for (let remove of removes) {
      await db.run(`
        DELETE FROM crawl_published_sites WHERE crawlSourceId = ? AND url = ?
      `, [crawlSource.id, remove])
      if (supressEvents) {
        events.emit('published-site-removed', archive.url, remove)
      }
    }

    // write checkpoint as success
    logger.silly(`Finished crawling published sites`, {details: {url: archive.url}})
    await doCheckpoint('crawl_published_sites', TABLE_VERSION, crawlSource, changes[changes.length - 1].version)
    emitProgressEvent(archive.url, 'crawl_published_sites', 1, 1)
  })
}

/**
 * @description
 * List sites published by subject.
 *
 * @param {string} subject - (URL)
 * @param {Object} [opts]
 * @param {string} [opts.type] - filter to the given type.
 * @param {boolean} [opts.includeDesc] - output a site description instead of a simple URL.
 * @returns {Promise<Array<string|SiteDescription>>}
 */
const listPublishedSites = exports.listPublishedSites = async function (subject, {type, includeDesc} = {}) {
  var WHERE = ''
  var queryParams = [subject]
  if (type) {
    WHERE = `WHERE (',' || type || ',') LIKE ?`
    queryParams.push(`%,${type},%`)
  }
  var rows = await db.all(`
    SELECT pub.url
      FROM crawl_published_sites pub
      INNER JOIN crawl_sources source
          ON pub.crawlSourceId = source.id
          AND source.url = ?
      ${WHERE}
  `, queryParams)
  if (!includeDesc) {
    return rows.map(row => toOrigin(row.url))
  }
  return Promise.all(rows.map(async (row) => {
    return siteDescriptions.getBest({subject: toOrigin(row.url)})
  }))
}

/**
 * @description
 * Check for the existence of a published site.
 *
 * @param {string} a - (URL) was this site published by 'b'?
 * @param {string} b - (URL) did this site publish 'a'?
 * @returns {Promise<boolean>}
 */
const isAPublishedByB = exports.isAPublishedByB = async function (a, b) {
  a = toOrigin(a)
  b = toOrigin(b)
  var res = await db.get(`
    SELECT pub.url
      FROM crawl_published_sites pub
      INNER JOIN crawl_sources source
          ON pub.crawlSourceId = source.id
          AND source.url = ?
      WHERE
        pub.url = ?
  `, [b, a])
  return !!res
}

/**
 * @description
 * Add a published site to the given archive.
 *
 * @param {InternalDatArchive} archive
 * @param {string} siteUrl
 * @returns {Promise<void>}
 */
exports.publishSite = async function (archive, siteUrl) {
  // normalize siteUrl
  siteUrl = toOrigin(siteUrl)
  assert(typeof siteUrl === 'string', 'publishSite() must be given a valid URL')

  // write new follows.json
  await updateSitesFile(archive, sitesJson => {
    if (!sitesJson.urls.find(v => v === siteUrl)) {
      sitesJson.urls.push(siteUrl)
    }
  })

  // capture site description
  /* dont await */siteDescriptions.capture(archive, siteUrl)
}

/**
 * @description
 * Remove a published site from the given archive.
 *
 * @param {InternalDatArchive} archive
 * @param {string} siteUrl
 * @returns {Promise<void>}
 */
exports.unpublishSite = async function (archive, siteUrl) {
  // normalize siteUrl
  siteUrl = toOrigin(siteUrl)
  assert(typeof siteUrl === 'string', 'unpublishSite() must be given a valid URL')

  // write new follows.json
  await updateSitesFile(archive, sitesJson => {
    var i = sitesJson.urls.findIndex(v => v === siteUrl)
    if (i !== -1) {
      sitesJson.urls.splice(i, 1)
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
async function readSitesFile (archive) {
  try {
    var sitesJson = await archive.pda.readFile(JSON_PATH, 'utf8')
  } catch (e) {
    if (e.notFound) return {type: JSON_TYPE, urls: []} // empty default when not found
    throw e
  }
  sitesJson = JSON.parse(sitesJson)
  assert(typeof sitesJson === 'object', 'File be an object')
  assert(sitesJson.type === JSON_TYPE, 'JSON type must be unwalled.garden/published-sites')
  assert(Array.isArray(sitesJson.urls), 'JSON .urls must be an array of strings')
  sitesJson.urls = sitesJson.urls.filter(v => typeof v === 'string').map(toOrigin)
  return sitesJson
}

/**
 * @param {InternalDatArchive} archive
 * @param {function(Object): void} updateFn
 * @returns {Promise<void>}
 */
async function updateSitesFile (archive, updateFn) {
  var release = await lock('crawler:published-sites:' + archive.url)
  try {
    // read the follows file
    try {
      var sitesJson = await readSitesFile(archive)
    } catch (err) {
      if (err.notFound) {
        // create new
        sitesJson = {
          type: JSON_TYPE,
          urls: []
        }
      } else {
        logger.warn('Failed to read published-sites file', {details: {url: archive.url, err}})
        throw err
      }
    }

    // apply update
    updateFn(sitesJson)

    // write the follows file
    await archive.pda.writeFile(JSON_PATH, JSON.stringify(sitesJson), 'utf8')

    // trigger crawl now
    await crawler.crawlSite(archive)
  } finally {
    release()
  }
}
