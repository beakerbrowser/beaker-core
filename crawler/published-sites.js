const assert = require('assert')
const Events = require('events')
const Ajv = require('ajv')
const logger = require('../logger').child({category: 'crawler', dataset: 'published-sites'})
const db = require('../dbs/profile-data-db')
const crawler = require('./index')
const siteDescriptions = require('./site-descriptions')
const {doCrawl, doCheckpoint, emitProgressEvent, toOrigin, toHostname, ensureDirectory, getMatchingChangesInOrder} = require('./util')
const publishedSiteSchema = require('./json-schemas/published-site')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/published-site'
const JSON_PATH_REGEX = /^\/data\/published-sites\/([^/]+)\.json$/i

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
 * 
 * @typedef {Object} PublishedSite
 * @prop {string} pathname
 * @prop {string} url
 * @prop {number} crawledAt
 * @prop {number} createdAt
 * @prop {SiteDescription} author
 */

// globals
// =

const events = new Events()
const ajv = (new Ajv())
const validatePublishedSite = ajv.compile(publishedSiteSchema)

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

    // collect changed site-records
    var changedSites = getMatchingChangesInOrder(changes, JSON_PATH_REGEX)
    if (changedSites.length) {
      logger.verbose('Collected new/changed published-site files', {details: {url: archive.url, changedSites: changedSites.map(p => p.name)}})
    } else {
      logger.debug('No new published-site files found', {details: {url: archive.url}})
    }
    emitProgressEvent(archive.url, 'crawl_published_sites', 0, changedSites.length)

    // read and apply each published-site in order
    var progress = 0
    for (let changedSite of changedSites) {
      // TODO Currently the crawler will abort reading the feed if any published-site fails to load
      //      this means that a single unreachable file can stop the forward progress of published-site indexing
      //      to solve this, we need to find a way to tolerate unreachable published-site-files without losing our ability to efficiently detect new published-sites
      //      -prf
      if (changedSite.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_published_sites WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedSite.name])
        events.emit('published-site-removed', archive.url)
      } else {
        // read
        let publishedSiteStr
        try {
          publishedSiteStr = await archive.pda.readFile(changedSite.name, 'utf8')
        } catch (err) {
          logger.warn('Failed to read published-site file, aborting', {details: {url: archive.url, name: changedSite.name, err}})
          return // abort indexing
        }

        // parse and validate
        let publishedSite
        try {
          publishedSite = JSON.parse(publishedSiteStr)
          let valid = validatePublishedSite(publishedSite)
          if (!valid) throw ajv.errorsText(validatePublishedSite.errors)
        } catch (err) {
          logger.warn('Failed to parse post file, skipping', {details: {url: archive.url, name: changedSite.name, err}})
          continue // skip
        }

        // massage the published-site
        publishedSite.createdAt = Number(new Date(publishedSite.createdAt))

        // upsert
        let existingPost = await get(archive.url, changedSite.name)
        if (existingPost) {
          await db.run(`
            UPDATE crawl_published_sites
              SET crawledAt = ?, url = ?, createdAt = ?
              WHERE crawlSourceId = ? AND pathname = ?
          `, [Date.now(), publishedSite.url, publishedSite.createdAt, crawlSource.id, changedSite.name])
          events.emit('published-site-updated', archive.url)
        } else {
          await db.run(`
            INSERT INTO crawl_published_sites (crawlSourceId, pathname, crawledAt, url, createdAt)
              VALUES (?, ?, ?, ?, ?)
          `, [crawlSource.id, changedSite.name, Date.now(), publishedSite.url, publishedSite.createdAt])
          events.emit('published-site-added', archive.url)
        }
      }

      // checkpoint our progress
      logger.silly(`Finished crawling published-sites`, {details: {url: archive.url}})
      await doCheckpoint('crawl_published_sites', TABLE_VERSION, crawlSource, changedSite.version)
      emitProgressEvent(archive.url, 'crawl_published_sites', ++progress, changedSites.length)
    }
  })
}

/**
 * @description
 * List sites published by publisher.
 *
 * @param {string} publisher - (URL)
 * @param {Object} [opts]
 * @param {string} [opts.type] - filter to the given type.
 * @param {boolean} [opts.includeDesc] - output a site description instead of a simple URL.
 * @returns {Promise<Array<string|SiteDescription>>}
 */
const listPublishedSites = exports.listPublishedSites = async function (publisher, {type, includeDesc} = {}) {
  var WHERE = ''
  var queryParams = [publisher]
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
 * Get crawled published-site.
 *
 * @param {string} url - The URL of the published-site or of the author (if pathname is provided).
 * @param {string} [pathname] - The pathname of the published-site.
 * @returns {Promise<PublishedSite>}
 */
const get = exports.get = async function (url, pathname = undefined) {
  // validate & parse params
  var urlParsed
  if (url) {
    try { urlParsed = new URL(url) }
    catch (e) { throw new Error('Failed to parse published-site URL: ' + url) }
  }
  pathname = pathname || urlParsed.pathname

  // execute query
  return await massagePublishedSiteRow(await db.get(`
    SELECT
        crawl_published_sites.*, src.url AS crawlSourceUrl
      FROM crawl_published_sites
      INNER JOIN crawl_sources src
        ON src.id = crawl_published_sites.crawlSourceId
        AND src.url = ?
      WHERE
        crawl_published_sites.pathname = ?
  `, [urlParsed.origin, pathname]))
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
  var siteOrigin = toOrigin(siteUrl)
  var siteHostname = toHostname(siteUrl)
  assert(typeof siteOrigin === 'string', 'publishSite() must be given a valid URL')

  await ensureDirectory(archive, '/data')
  await ensureDirectory(archive, '/data/published-sites')
  await archive.pda.writeFile(`/data/published-sites/${siteHostname}.json`, JSON.stringify({
    type: JSON_TYPE,
    url: siteOrigin,
    createdAt: (new Date()).toISOString()
  }))
  await crawler.crawlSite(archive)

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
  var siteHostname = toHostname(siteUrl)
  assert(typeof siteHostname === 'string', 'unpublishSite() must be given a valid URL')

  // remove the file
  await archive.pda.unlink(`/data/published-sites/${siteHostname}.json`)
  await crawler.crawlSite(archive)
}

// internal methods
// =

/**
 * @param {Object} row
 * @returns {Promise<PublishedSite>}
 */
async function massagePublishedSiteRow (row) {
  if (!row) return null
  var author = await siteDescriptions.getBest({subject: row.crawlSourceUrl})
  if (!author) author = {url: row.crawlSourceUrl}
  return {
    pathname: row.pathname,
    author,
    url: row.url,
    crawledAt: row.crawledAt,
    createdAt: row.createdAt
  }
}
