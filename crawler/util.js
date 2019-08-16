const EventEmitter = require('events')
const pump = require('pump')
const concat = require('concat-stream')
const db = require('../dbs/profile-data-db')
const knex = require('../lib/knex')
const dat = require('../dat')

const READ_TIMEOUT = 30e3

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 *
 * @typedef {Object} CrawlSourceRecord
 * @prop {string} id
 * @prop {string} url
 * @prop {number} datDnsId
 * @prop {boolean} globalResetRequired
 */

// exported api
// =

const crawlerEvents = new EventEmitter()
exports.crawlerEvents = crawlerEvents

/**
 * @param {DaemonDatArchive} archive
 * @param {CrawlSourceRecord} crawlSource
 * @param {string} crawlDataset
 * @param {number} crawlDatasetVersion
 * @param {function(Object): Promise<void>} handlerFn
 * @returns {Promise}
 */
exports.doCrawl = async function (archive, crawlSource, crawlDataset, crawlDatasetVersion, handlerFn) {
  const url = archive.url

  // fetch current crawl state
  var resetRequired = false
  var state = await db.get(
    knex('crawl_sources_meta')
      .select('crawl_sources_meta.*')
      .where({crawlSourceId: crawlSource.id, crawlDataset})
  )
  if (crawlSource.globalResetRequired || (state && state.crawlDatasetVersion !== crawlDatasetVersion)) {
    resetRequired = true
    state = null
  }
  if (!state) {
    state = {crawlSourceVersion: 0, crawlDatasetVersion}
  }

  // fetch current archive version
  var archiveInfo = await archive.getInfo()
  var version = archiveInfo ? archiveInfo.version : 0

  // fetch change log
  var changes
  var start = state.crawlSourceVersion + 1
  var end = version + 1
  if (start === end) {
    changes = []
  } else {
    let stream = await archive.session.drive.createDiffStream(start, '/')
    changes = await new Promise((resolve, reject) => {
      pump(stream, concat({encoding: 'object'}, resolve), reject)
    })
  }

  // TEMPORARY
  // createDiffStream() doesnt include a .version
  // we need an accurate version to checkpoint progress
  // for now, use the earliest version
  // -prf
  changes.forEach(c => { c.version = version })

  crawlerEvents.emit('crawl-dataset-start', {sourceUrl: archive.url, crawlDataset, crawlRange: {start, end}})

  // handle changes
  await handlerFn({changes, resetRequired})

  // final checkpoint
  await doCheckpoint(crawlDataset, crawlDatasetVersion, crawlSource, version)

  crawlerEvents.emit('crawl-dataset-finish', {sourceUrl: archive.url, crawlDataset, crawlRange: {start, end}})
}

/**
 * @param {string} crawlDataset
 * @param {number} crawlDatasetVersion
 * @param {CrawlSourceRecord} crawlSource
 * @param {number} crawlSourceVersion
 * @returns {Promise}
 */
const doCheckpoint = exports.doCheckpoint = async function (crawlDataset, crawlDatasetVersion, crawlSource, crawlSourceVersion) {
  // TODO chould this be an INSERT OR REPLACE?
  await db.run(knex('crawl_sources_meta').delete().where({crawlDataset, crawlSourceId: crawlSource.id}))
  await db.run(knex('crawl_sources_meta').insert({
    crawlDataset,
    crawlDatasetVersion,
    crawlSourceId: crawlSource.id,
    crawlSourceVersion,
    updatedAt: Date.now()
  }))
}

/**
 * @param {string} sourceUrl
 * @param {string} crawlDataset
 * @param {number} progress
 * @param {number} numUpdates
 */
exports.emitProgressEvent = function (sourceUrl, crawlDataset, progress, numUpdates) {
  crawlerEvents.emit('crawl-dataset-progress', {sourceUrl, crawlDataset, progress, numUpdates})
}

/**
 * @param {Array<Object>} changes
 * @param {RegExp} regex
 * @returns {Array<Object>}
 */
exports.getMatchingChangesInOrder = function (changes, regex) {
  var list = []
  list = changes.filter(c => regex.test(c.name))
  list.sort((a, b) => a.version - b.version) // order matters, must be oldest to newest
  return list
}

/**
 * @returns {string}
 */
var _lastGeneratedTimeFilename
exports.generateTimeFilename = function () {
  var d = Date.now()
  if (d === _lastGeneratedTimeFilename) {
    d++
  }
  _lastGeneratedTimeFilename = d
  return (new Date(d)).toISOString()
}

/**
 * @param {string} url
 * @returns {string}
 */
const toHostname =
exports.toHostname = function (url) {
  var urlParsed = new URL(url)
  return urlParsed.hostname
}

/**
 * @param {string} url
 * @param {boolean?} shouldThrow
 * @returns {string}
 */
const toOrigin =
exports.toOrigin = function (url, shouldThrow = false) {
  try {
    var urlParsed = new URL(url)
    return urlParsed.protocol + '//' + urlParsed.hostname
  } catch (e) {
    if (shouldThrow) {
      throw new Error('Invalid URL: ' + url)
    }
    return null
  }
}

/**
 * @param {string} url
 * @returns {string}
 */
exports.normalizeTopicUrl = function (url) {
  try {
    var urlp = new URL(url)
    return (urlp.protocol + '//' + urlp.hostname + urlp.pathname + urlp.search + urlp.hash).replace(/([/]$)/g, '')
  } catch (e) {}
  return null
}

/**
 * @param {string} url
 * @returns {string}
 */
exports.normalizeSchemaUrl = function (url) {
  try {
    var urlp = new URL(url)
    return (urlp.hostname + urlp.pathname + urlp.search + urlp.hash).replace(/([/]$)/g, '')
  } catch (e) {}
  return url
}

/**
 * @param {DaemonDatArchive} archive
 * @param {string} pathname
 * @returns {Promise}
 */
exports.ensureDirectory = async function (archive, pathname) {
  try { await archive.pda.mkdir(pathname) }
  catch (e) { /* ignore */ }
}

/**
 * @description Helper to determine the thumbUrl for a site description.
 * @param {string} author - (URL) the author of the site description.
 * @param {string} subject - (URL) the site being described.
 * @returns {string} - the URL of the thumbnail.
 */
exports.getSiteDescriptionThumbnailUrl = function (author, subject) {
  return author === subject
    ? `${subject}/thumb` // self-description, use their own thumb
    : `${author}/data/known-sites/${toHostname(subject)}/thumb` // use captured thumb
}

/**
 * @param {string} url
 * @returns {string}
 */
var reservedChars = /[<>:"/\\|?*\x00-\x1F]/g
var endingDashes = /([-]+$)/g
exports.slugifyUrl = function (str) {
  try {
    let url = new URL(str)
    str = url.protocol + url.hostname + url.pathname + url.search + url.hash
  } catch (e) {
    // ignore
  }
  return str.replace(reservedChars, '-').replace(endingDashes, '')
}