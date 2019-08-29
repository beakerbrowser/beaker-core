const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const logger = require('../logger').child({category: 'uwg', dataset: 'site-descriptions'})
const db = require('../dbs/profile-data-db')
const archivesDb = require('../dbs/archives')
const dat = require('../dat')
const uwg = require('./index')
const {
  doCrawl,
  doCheckpoint,
  emitProgressEvent,
  getMatchingChangesInOrder,
  getSiteDescriptionThumbnailUrl,
  toHostname
} = require('./util')

// constants
// =

const TABLE_VERSION = 1
const JSON_PATH_REGEX = /^\/(dat\.json|data\/known-sites\/([^/]+)\/dat\.json)$/i

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 *
 * @typedef {Object} SiteDescription
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<string>} type
 * @prop {string} thumbUrl
 * @prop {Object} descAuthor
 * @prop {string} descAuthor.url
 * @prop {boolean} [followsUser] - does this site follow the specified user site?
 * @prop {Array<SiteDescription>} [followedBy] - list of sites following this site.
 * @prop {boolean} isOwner
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
 * @param {DaemonDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise<void>}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_site_descriptions', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling site descriptions', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_site_descriptions WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_site_descriptions', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed site descriptions
    var changedSiteDescriptions = getMatchingChangesInOrder(changes, JSON_PATH_REGEX)
    if (changedSiteDescriptions.length > 0) {
      logger.verbose('Collected new/changed site-description files', {details: {url: archive.url, changedFiles: changedSiteDescriptions.map(p => p.name)}})
    } else {
      logger.debug('No new site-description files found', {details: {url: archive.url}})
    }
    emitProgressEvent(archive.url, 'crawl_site_descriptions', 0, changedSiteDescriptions.length)

    // read and apply each post in order
    var progress = 0
    for (let changedSiteDescription of changedSiteDescriptions) {
      // TODO Currently the crawler will abort reading the feed if any description fails to load
      //      this means that a single unreachable file can stop the forward progress of description indexing
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
        // read
        let descString
        try {
          descString = await archive.pda.readFile(changedSiteDescription.name, 'utf8')
        } catch (err) {
          logger.warn('Failed to read dat.json file, aborting', {details: {url: archive.url, name: changedSiteDescription.name, err}})
          return // abort indexing
        }

        // parse and validate
        let desc
        try {
          desc = JSON.parse(descString)
          assert(typeof desc === 'object', 'File be an object')
        } catch (err) {
          logger.warn('Failed to parse dat.json file, aborting', {details: {url: archive.url, name: changedSiteDescription.name, err}})
          continue // skip
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
          INSERT INTO crawl_site_descriptions (crawlSourceId, crawledAt, url, title, description, type)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [crawlSource.id, Date.now(), url, desc.title, desc.description, desc.type.join(',')])
        events.emit('description-added', archive.url)
      }

      // checkpoint our progress
      logger.silly(`Finished crawling site descriptions`, {details: {url: archive.url}})
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
 * @param {string | Array<string>} [opts.subject] - (URL) filter descriptions to those which describe this subject.
 * @param {string | Array<string>} [opts.author] - (URL) filter descriptions to those created by this author.
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
    try { author = await Promise.all(author.map(dat.archives.getPrimaryUrl)) }
    catch (e) { throw new Error('Author must contain valid URLs') }
  }
  if (subject) {
    subject = Array.isArray(subject) ? subject : [subject]
    try { subject = await Promise.all(subject.map(dat.archives.getPrimaryUrl)) }
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
  return Promise.all((await db.all(query, values)).map(massageSiteDescriptionRow))
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
 * Capture a site description into the archive's known-sites cache.
 *
 * @param {DaemonDatArchive} archive - where to write the capture to.
 * @param {(DaemonDatArchive|string)} subject - which archive to capture.
 * @returns Promise
 */
exports.capture = async function (archive, subject) {
  var subjectArchive
  if (typeof subject === 'string') {
    subjectArchive = await dat.archives.getOrLoadArchive(subject)
  } else {
    subjectArchive = subject
  }

  // create directory
  var hostname = toHostname(subjectArchive.url)
  await ensureDirectory(archive, '/data')
  await ensureDirectory(archive, '/data/known-sites')
  await ensureDirectory(archive, `/data/known-sites/${hostname}`)

  // capture dat.json
  try {
    var datJson = JSON.parse(await subjectArchive.pda.readFile('/dat.json'))
  } catch (err) {
    logger.warn('Failed to read dat.json of subject archive', {details: {err}})
    throw new Error('Unabled to read subject dat.json')
  }
  await archive.pda.writeFile(`/data/known-sites/${hostname}/dat.json`, JSON.stringify(datJson, null, 2))

  // capture thumb
  for (let ext of ['jpg', 'jpeg', 'png']) {
    let thumbPath = `/thumb.${ext}`
    if (await fileExists(subjectArchive, thumbPath)) {
      let targetPath = `/data/known-sites/${hostname}/thumb.${ext}`
      await archive.pda.writeFile(targetPath, await subjectArchive.pda.readFile(thumbPath, 'binary'), 'binary')
      break
    }
  }
}

/**
 * @description
 * Delete a captured site description in the given archive's known-sites cache.
 *
 * @param {DaemonDatArchive} archive - where to remove the capture from.
 * @param {(DaemonDatArchive|string)} subject - which archive's capture to remove.
 * @returns Promise
 */
exports.deleteCapture = async function (archive, subject) {
  var subjectUrl
  if (typeof subject === 'string') {
    subjectUrl = subject
  } else {
    subjectUrl = subject.url
  }
  assert(typeof subjectUrl === 'string', 'Delete() must be provided a valid URL string')
  var hostname = toHostname(subjectUrl)
  await archive.pda.rmdir(`/data/known-sites/${hostname}`, {recursive: true})
  await uwg.crawlSite(archive)
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

/**
 * @param {DaemonDatArchive} archive
 * @param {string} name
 * @returns {string}
 */
function getUrlFromDescriptionPath (archive, name) {
  if (name === '/dat.json') return archive.url
  var parts = name.split('/') // '/data/known-sites/{hostname}/dat.json' -> ['', 'data', 'known-sites', hostname, 'dat.json']
  return 'dat://' + parts[3]
}

/**
 * @param {DaemonDatArchive} archive
 * @param {string} pathname
 * @returns {Promise<void>}
 */
async function ensureDirectory (archive, pathname) {
  try { await archive.pda.mkdir(pathname) }
  catch (e) { /* ignore */ }
}

/**
 * @param {DaemonDatArchive} archive
 * @param {string} pathname
 * @returns {Promise<boolean>}
 */
async function fileExists (archive, pathname) {
  try { await archive.pda.stat(pathname) }
  catch (e) { return false }
  return true
}

/**
 * @param {Object} row
 * @returns {Promise<SiteDescription>}
 */
async function massageSiteDescriptionRow (row) {
  if (!row) return null
  row.author = {url: row.crawlSourceUrl}
  row.type = row.type && typeof row.type === 'string' ? row.type.split(',') : undefined
  row.thumbUrl = getSiteDescriptionThumbnailUrl(row.author.url, row.url)
  row.isOwner = (await archivesDb.getMeta(row.url)).isOwner
  delete row.crawlSourceUrl
  delete row.crawlSourceId
  return row
}
