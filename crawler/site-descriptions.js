const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const db = require('../dbs/profile-data-db')
const archivesDb = require('../dbs/archives')
const dat = require('../dat')
const crawler = require('./index')
const {
  doCrawl,
  doCheckpoint,
  emitProgressEvent,
  getMatchingChangesInOrder,
  generateTimeFilename,
  getSiteDescriptionThumbnailUrl,
  toHostname
} = require('./util')
const debug = require('../lib/debug-logger').debugLogger('crawler')

// constants
// =

const TABLE_VERSION = 1
const JSON_PATH_REGEX = /^\/(dat\.json|data\/known_sites\/([^/]+)\/dat\.json)$/i

// typedefs
// =

/**
 * @typedef CrawlSourceRecord {import('./util').CrawlSourceRecord}
 *
 * @typedef {Object} SiteDescription
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<string>} type
 * @prop {string} thumbUrl
 * @prop {Object} descAuthor
 * @prop {string} descAuthor.url
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
 * Crawl the given site for site descriptions.
 *
 * @param {InternalDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_site_descriptions', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    console.log('Crawling site descriptions for', archive.url, {changes, resetRequired})
    if (resetRequired) {
      // reset all data
      await db.run(`
        DELETE FROM crawl_site_descriptions WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_site_descriptions', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed site descriptions
    var changedSiteDescriptions = getMatchingChangesInOrder(changes, JSON_PATH_REGEX)
    console.log('collected changed site descriptions', changedSiteDescriptions)
    emitProgressEvent(archive.url, 'crawl_site_descriptions', 0, changedSiteDescriptions.length)

    // read and apply each post in order
    var progress = 0
    for (let changedSiteDescription of changedSiteDescriptions) {
      // TODO Currently the crawler will abort reading the feed if any description fails to load
      //      this means that a single bad or unreachable file can stop the forward progress of description indexing
      //      to solve this, we need to find a way to tolerate bad description-files without losing our ability to efficiently detect new posts
      //      -prf

      // determine the url
      let url = getUrlFromDescriptionPath(archive, changedSiteDescription.name)

      if (changedSiteDescription.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_site_descriptions WHERE crawlSourceId = ? AND url = ?
        `, [crawlSource.id, url])
        events.emit('description-removed', archive.url)
      } else {
        // read and validate
        let desc
        try {
          desc = JSON.parse(await archive.pda.readFile(changedSiteDescription.name, 'utf8'))
          assert(typeof desc === 'object', 'File be an object')
        } catch (err) {
          console.error('Failed to read site-description file', {url: archive.url, name: changedSiteDescription.name, err})
          debug('Failed to read site-description file', {url: archive.url, name: changedSiteDescription.name, err})
          return // abort indexing
        }

        // massage the description
        desc.title = typeof desc.title === 'string' ? desc.title : ''
        desc.description = typeof desc.description === 'string' ? desc.description : ''
        if (typeof desc.type === 'string') desc.type = desc.type.split(',')
        if (Array.isArray(desc.type)) {
          desc.type = desc.type.filter(isString)
        } else {
          desc.type = []
        }

        // replace
        await db.run(`
          DELETE FROM crawl_site_descriptions WHERE crawlSourceId = ? AND url = ?
        `, [crawlSource.id, url])
        await db.run(`
          INSERT OR REPLACE INTO crawl_site_descriptions (crawlSourceId, crawledAt, url, title, description, type)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [crawlSource.id, Date.now(), url, desc.title, desc.description, desc.type.join(',')])
        events.emit('description-added', archive.url)
      }

      // checkpoint our progress
      await doCheckpoint('crawl_site_descriptions', TABLE_VERSION, crawlSource, changedSiteDescription.version)
      emitProgressEvent(archive.url, 'crawl_site_descriptions', ++progress, changedSiteDescription.length)
    }
  })
}

/**
 * @description
 * List crawled site descriptions.
 *
 * @param {Object} [opts]
 * @param {string} [opts.subject] - (URL) filter descriptions to those which describe this subject.
 * @param {string} [opts.author] - (URL) filter descriptions to those created by this author.
 * @param {number} [opts.offset]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<SiteDescription>>}
 */
const list = exports.list = async function ({offset, limit, reverse, author, subject} = {}) {
  // validate & parse params
  assert(!offset || typeof offset === 'number', 'Offset must be a number')
  assert(!limit || typeof limit === 'number', 'Limit must be a number')
  assert(!reverse || typeof reverse === 'boolean', 'Reverse must be a boolean')
  assert(!author || typeof author === 'string' || (Array.isArray(author) && author.every(isString)), 'Author must be a string or an array of strings')
  assert(!subject || typeof subject === 'string' || (Array.isArray(subject) && subject.every(isString)), 'Subject must be a string or an array of strings')

  if (author) {
    author = Array.isArray(author) ? author : [author]
    try { author = author.map(toOrigin) }
    catch (e) { throw new Error('Author must contain valid URLs') }
  }
  if (subject) {
    subject = Array.isArray(subject) ? subject : [subject]
    try { subject = subject.map(toOrigin) }
    catch (e) { throw new Error('Subject must contain valid URLs') }
  }

  // build query
  var query = `
    SELECT crawl_site_descriptions.*, src.url AS crawlSourceUrl FROM crawl_site_descriptions
      INNER JOIN crawl_sources src ON src.id = crawl_site_descriptions.crawlSourceId
  `
  var values = []

  if (author || subject) {
    query += ` WHERE `
  }

  if (author) {
    query += `(`
    let op = ``
    for (let a of author) {
      query += `${op} src.url = ?`
      op = ` OR`
      values.push(a)
    }
    query += `) `
  }
  if (subject) {
    if (author) {
      query += ` AND `
    }
    query += `(`
    let op = ``
    for (let s of subject) {
      query += `${op} crawl_site_descriptions.url = ?`
      op = ` OR`
      values.push(s)
    }
    query += `) `
  }
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
  return (await db.all(query, values)).map(massageSiteDescriptionRow)
}

/**
 * @description
 * Get the most trustworthy site description available.
 *
 * @param {Object} [opts]
 * @param {string} [opts.subject] - (URL) filter descriptions to those which describe this subject.
 * @param {string} [opts.author] - (URL) filter descriptions to those created by this author.
 * @returns {Promise<SiteDescription>}
 */
exports.getBest = async function ({subject, author} = {}) {
  // TODO choose based on trust
  var descriptions = await list({subject, author})
  return descriptions[0]
}

/**
 * @description
 * Capture a site description into the archive's known_sites cache.
 *
 * @param {InternalDatArchive} archive - where to write the capture to.
 * @param {(InternalDatArchive|string)} subjectArchive - which archive to capture.
 * @returns Promise
 */
exports.capture = async function (archive, subjectArchive) {
  if (typeof subjectArchive === 'string') {
    subjectArchive = await dat.library.getOrLoadArchive(subjectArchive)
  }

  // create directory
  var hostname = toHostname(subjectArchive.url)
  await ensureDirectory(archive, '/data')
  await ensureDirectory(archive, '/data/known_sites')
  await ensureDirectory(archive, `/data/known_sites/${hostname}`)

  // capture dat.json
  try {
    var datJson = JSON.parse(await subjectArchive.pda.readFile('/dat.json'))
  } catch (e) {
    console.error('Failed to read dat.json of subject archive', e)
    debug('Failed to read dat.json of subject archive', e)
    throw new Error('Unabled to read subject dat.json')
  }
  await archive.pda.writeFile(`/data/known_sites/${hostname}/dat.json`, JSON.stringify(datJson))

  // capture thumb
  for (let ext of ['jpg', 'jpeg', 'png']) {
    let thumbPath = `/thumb.${ext}`
    if (await fileExists(subjectArchive, thumbPath)) {
      let targetPath = `/data/known_sites/${hostname}/thumb.${ext}`
      await archive.pda.writeFile(targetPath, await subjectArchive.pda.readFile(thumbPath, 'binary'), 'binary')
      break
    }
  }
}

/**
 * @description
 * Delete a captured site description in the given archive's known_sites cache.
 *
 * @param {InternalDatArchive} archive - where to remove the capture from.
 * @param {(InternalDatArchive|string)} subjectUrl - which archive's capture to remove.
 * @returns Promise
 */
exports.deleteCapture = async function (archive, subjectUrl) {
  if (subjectUrl && subjectUrl.url) {
    subjectUrl = subjectUrl.url
  }
  assert(typeof subjectUrl === 'string', 'Delete() must be provided a valid URL string')
  var hostname = toHostname(subjectUrl)
  await archive.pda.rmdir(`/data/known_sites/${hostname}`, {recursive: true})
  await crawler.crawlSite(archive)
}

// internal methods
// =

/**
 * @param {any} v
 * returns {boolean}
 */
function isString (v) {
  return typeof v === 'string'
}

/**
 * @param {string} url
 * @returns {string}
 */
function toOrigin (url) {
  url = new URL(url)
  return url.protocol + '//' + url.hostname
}

/**
 * @param {InternalDatArchive} archive
 * @param {string} name
 * @returns {string}
 */
function getUrlFromDescriptionPath (archive, name) {
  if (name === '/dat.json') return archive.url
  name = name.split('/') // '/data/known_sites/{hostname}/dat.json' -> ['', 'data', 'known_sites', hostname, 'dat.json']
  return 'dat://' + name[3]
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
 * @param {InternalDatArchive} archive
 * @param {string} pathname
 * @returns {Promise}
 */
async function fileExists (archive, pathname) {
  try { await archive.pda.stat(pathname) }
  catch (e) { return false }
  return true
}

/**
 * @param {Object} row
 * @returns {SiteDescription}
 */
function massageSiteDescriptionRow (row) {
  if (!row) return null
  row.author = {url: row.crawlSourceUrl}
  row.type = row.type && typeof row.type === 'string' ? row.type.split(',') : undefined
  row.thumbUrl = getSiteDescriptionThumbnailUrl(row.author.url, row.url)
  delete row.crawlSourceUrl
  delete row.crawlSourceId
  return row
}
