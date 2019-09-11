const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const Ajv = require('ajv')
const logger = require('../logger').child({category: 'uwg', dataset: 'statuses'})
const db = require('../dbs/profile-data-db')
const uwg = require('./index')
const datArchives = require('../dat/archives')
const archivesDb = require('../dbs/archives')
const lock = require('../lib/lock')
const knex = require('../lib/knex')
const {
  doCrawl,
  doCheckpoint,
  emitProgressEvent,
  getMatchingChangesInOrder,
  generateTimeFilename,
  ensureDirectory
} = require('./util')
const statusSchema = require('./json-schemas/status')

// constants
// =

const TABLE_VERSION = 2
const JSON_TYPE = 'unwalled.garden/status'
const JSON_PATH_REGEX = /^\/\.data\/statuses\/([^/]+)\.json$/i

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef { import("../dbs/archives").LibraryArchiveMeta } LibraryArchiveMeta
 *
 * @typedef {Object} Status
 * @prop {string} pathname
 * @prop {string} body
 * @prop {string} createdAt
 * @prop {string} updatedAt
 * @prop {LibraryArchiveMeta} author
 * @prop {string} visibility
 */

// globals
// =

const events = new Events()
const ajv = (new Ajv())
const validateStatus = ajv.compile(statusSchema)

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for statuses.
 *
 * @param {DaemonDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_statuses', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling statuses', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_statuses WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_statuses', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed statuses
    var changedStatuses = getMatchingChangesInOrder(changes, JSON_PATH_REGEX)
    if (changedStatuses.length) {
      logger.verbose('Collected new/changed status files', {details: {url: archive.url, changedStatuses: changedStatuses.map(p => p.name)}})
    } else {
      logger.debug('No new status-files found', {details: {url: archive.url}})
    }
    emitProgressEvent(archive.url, 'crawl_statuses', 0, changedStatuses.length)

    // read and apply each status in order
    var progress = 0
    for (let changedStatus of changedStatuses) {
      // TODO Currently the crawler will abort reading the feed if any status fails to load
      //      this means that a single unreachable file can stop the forward progress of status indexing
      //      to solve this, we need to find a way to tolerate unreachable status-files without losing our ability to efficiently detect new statuses
      //      -prf
      if (changedStatus.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_statuses WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedStatus.name])
        events.emit('status-removed', archive.url)
      } else {
        // read
        let statusString
        try {
          statusString = await archive.pda.readFile(changedStatus.name, 'utf8')
        } catch (err) {
          logger.warn('Failed to read status file, aborting', {details: {url: archive.url, name: changedStatus.name, err}})
          return // abort indexing
        }

        // parse and validate
        let status
        try {
          status = JSON.parse(statusString)
          let valid = validateStatus(status)
          if (!valid) throw ajv.errorsText(validateStatus.errors)
        } catch (err) {
          logger.warn('Failed to parse status file, skipping', {details: {url: archive.url, name: changedStatus.name, err}})
          continue // skip
        }

        // massage the status
        status.createdAt = Number(new Date(status.createdAt))
        status.updatedAt = Number(new Date(status.updatedAt))
        if (isNaN(status.updatedAt)) status.updatedAt = 0 // optional

        // upsert
        let existingStatus = await get(joinPath(archive.url, changedStatus.name))
        if (existingStatus) {
          await db.run(`
            UPDATE crawl_statuses
              SET crawledAt = ?, body = ?, createdAt = ?, updatedAt = ?
              WHERE crawlSourceId = ? AND pathname = ?
          `, [Date.now(), status.body, status.createdAt, status.updatedAt, crawlSource.id, changedStatus.name])
          events.emit('status-updated', archive.url)
        } else {
          await db.run(`
            INSERT INTO crawl_statuses (crawlSourceId, pathname, crawledAt, body, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?)
          `, [crawlSource.id, changedStatus.name, Date.now(), status.body, status.createdAt, status.updatedAt])
          events.emit('status-added', archive.url)
        }
      }

      // checkpoint our progress
      await doCheckpoint('crawl_statuses', TABLE_VERSION, crawlSource, changedStatus.version)
      emitProgressEvent(archive.url, 'crawl_statuses', ++progress, changedStatuses.length)
    }
    logger.silly(`Finished crawling statuses`, {details: {url: archive.url}})
  })
}

/**
 * @description
 * List crawled statuses.
 *
  * @param {Object} [opts]
  * @param {Object} [opts.filters]
  * @param {string|string[]} [opts.filters.authors]
  * @param {string} [opts.filters.visibility]
  * @param {string} [opts.sortBy]
  * @param {number} [opts.offset=0]
  * @param {number} [opts.limit]
  * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Status>>}
 */
exports.list = async function (opts) {
  // TODO: handle visibility
  // TODO: sortBy options

  // validate & parse params
  if (opts && 'sortBy' in opts) assert(typeof opts.sortBy === 'string', 'SortBy must be a string')
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
      opts.filters.authors = await Promise.all(opts.filters.authors.map(datArchives.getPrimaryUrl))
    }
    if ('visibility' in opts.filters) {
      assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
    }
  }

  // build query
  var sql = knex('crawl_statuses')
    .select('crawl_statuses.*')
    .select('crawl_sources.url AS crawlSourceUrl')
    .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_statuses.crawlSourceId')
    .orderBy('crawl_statuses.createdAt', opts.reverse ? 'DESC' : 'ASC')
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }
  if (opts && opts.limit) sql = sql.limit(opts.limit)
  if (opts && opts.offset) sql = sql.offset(opts.offset)

  // execute query
  var rows = await db.all(sql)
  return Promise.all(rows.map(massageStatusRow))
}

/**
 * @description
 * Get crawled status.
 *
 * @param {string} url - The URL of the status
 * @returns {Promise<Status>}
 */
const get = exports.get = async function (url) {
  // validate & parse params
  var urlParsed
  if (url) {
    try { urlParsed = new URL(url) }
    catch (e) { throw new Error('Invalid URL: ' + url) }
  }

  // execute query
  var sql = knex('crawl_statuses')
    .select('crawl_statuses.*')
    .select('crawl_sources.url AS crawlSourceUrl')
    .innerJoin('crawl_sources', function () {
      this.on('crawl_sources.id', '=', 'crawl_statuses.crawlSourceId')
        .andOn('crawl_sources.url', '=', knex.raw('?', `${urlParsed.protocol}//${urlParsed.hostname}`))
    })
    .where('crawl_statuses.pathname', urlParsed.pathname)
  return await massageStatusRow(await db.get(sql))
}

/**
 * @description
 * Create a new status.
 *
 * @param {DaemonDatArchive} archive - where to write the status to.
 * @param {Object} status
 * @param {string} status.body
 * @param {string} status.visibility
 * @returns {Promise<string>} url
 */
exports.add = async function (archive, status) {
  // TODO visibility

  var statusObject = {
    type: JSON_TYPE,
    body: status.body,
    createdAt: (new Date()).toISOString()
  }
  var valid = validateStatus(statusObject)
  if (!valid) throw ajv.errorsText(validateStatus.errors)

  var filename = generateTimeFilename()
  var filepath = `/.data/statuses/${filename}.json`
  await ensureDirectory(archive, '/.data/statuses')
  await archive.pda.writeFile(filepath, JSON.stringify(statusObject, null, 2))
  await uwg.crawlSite(archive)
  return archive.url + filepath
}

/**
 * @description
 * Update the content of an existing status.
 *
 * @param {DaemonDatArchive} archive - where to write the status to.
 * @param {string} pathname - the pathname of the status.
 * @param {Object} status
 * @param {string} [status.body]
 * @param {string} [status.visibility]
 * @returns {Promise<void>}
 */
exports.edit = async function (archive, pathname, status) {
  // TODO visibility

  var release = await lock('crawler:statuses:' + archive.url)
  try {
    // fetch status
    var existingStatus = await get(archive.url + pathname)
    if (!existingStatus) throw new Error('Status not found')

    // update status content
    var statusObject = {
      type: JSON_TYPE,
      body: ('body' in status) ? status.body : existingStatus.body,
      createdAt: existingStatus.createdAt,
      updatedAt: (new Date()).toISOString()
    }

    // validate
    var valid = validateStatus(statusObject)
    if (!valid) throw ajv.errorsText(validateStatus.errors)

    // write
    await archive.pda.writeFile(pathname, JSON.stringify(statusObject, null, 2))
    await uwg.crawlSite(archive)
  } finally {
    release()
  }
}

/**
 * @description
 * Delete an existing status
 *
 * @param {DaemonDatArchive} archive - where to write the status to.
 * @param {string} pathname - the pathname of the status.
 * @returns {Promise<void>}
 */
exports.remove = async function (archive, pathname) {
  assert(typeof pathname === 'string', 'Remove() must be provided a valid URL string')
  await archive.pda.unlink(pathname)
  await uwg.crawlSite(archive)
}

// internal methods
// =

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
 * @returns {Promise<Status>}
 */
async function massageStatusRow (row) {
  if (!row) return null
  var author = await archivesDb.getMeta(row.crawlSourceUrl)
  return {
    pathname: row.pathname,
    author,
    body: row.body,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    visibility: 'public' // TODO visibility
  }
}
