const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const _pick = require('lodash.pick')
const db = require('../dbs/profile-data-db')
const archivesDb = require('../dbs/archives')
const dat = require('../dat')
const crawler = require('./index')
const {doCrawl, doCheckpoint, getMatchingChangesInOrder, generateTimeFilename} = require('./util')
const debug = require('../lib/debug-logger').debugLogger('crawler')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/site-description'
const JSON_PATH_REGEX = /^\/data\/known_sites\/([^/]+)\.json$/i

// globals
// =

var events = new Events()

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

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

    // read and apply each post in order
    for (let changedSiteDescription of changedSiteDescriptions) {
      // TODO Currently the crawler will abort reading the feed if any description fails to load
      //      this means that a single bad or unreachable file can stop the forward progress of description indexing
      //      to solve this, we need to find a way to tolerate bad description-files without losing our ability to efficiently detect new posts
      //      -prf
      if (changedSiteDescription.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_site_descriptions WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedSiteDescription.name])
        events.emit('description-removed', archive.url)
      } else {
        // read and validate
        let desc
        try {
          desc = JSON.parse(await archive.pda.readFile(changedSiteDescription.name, 'utf8'))
          assert(typeof desc === 'object', 'File be an object')
          assert(desc.type === 'unwalled.garden/site-description', 'JSON .type must be unwalled.garden/site-description')
          assert(typeof desc.subject === 'string', 'JSON .subject must be a URL string')
          try { let subject = new URL(desc.subject) }
          catch (e) { throw new Error('JSON .subject must be a URL string') }
          assert(desc.metadata && typeof desc.metadata === 'object', 'JSON .metadata must be object')
          assert(typeof desc.createdAt === 'string', 'JSON .createdAt must be a date-time')
          assert(!isNaN(Number(new Date(desc.createdAt))), 'JSON .createdAt must be a date-time')
        } catch (err) {
          debug('Failed to read site-description file', {url: archive.url, name: changedSiteDescription.name, err})
          return // abort indexing
        }

        // massage the description
        desc.subject = toOrigin(desc.subject)
        desc.metadata.title = typeof desc.metadata.title === 'string' ? desc.metadata.title : ''
        desc.metadata.description = typeof desc.metadata.description === 'string' ? desc.metadata.description : ''
        if (typeof desc.metadata.type === 'string') desc.metadata.type = desc.metadata.type.split(',')
        if (Array.isArray(desc.metadata.type)) {
          desc.metadata.type = desc.metadata.type.filter(isString)
        } else {
          desc.metadata.type = []
        }
        desc.createdAt = Number(new Date(desc.createdAt))

        // replace
        await db.run(`
          DELETE FROM crawl_site_descriptions WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedSiteDescription.name])
        await db.run(`
          INSERT OR REPLACE INTO crawl_site_descriptions (crawlSourceId, pathname, crawledAt, subject, title, description, type, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [crawlSource.id, changedSiteDescription.name, Date.now(), desc.subject, desc.metadata.title, desc.metadata.description, desc.metadata.type.join(','), desc.createdAt])
        events.emit('description-added', archive.url)

        // checkpoint our progress
        await doCheckpoint('crawl_site_descriptions', TABLE_VERSION, crawlSource, changedSiteDescription.version)
      }
    }
  })
}

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
      query += `${op} subject = ?`
      op = ` OR`
      values.push(s)
    }
    query += `) `
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
  return (await db.all(query, values)).map(massageSiteDescriptionRow)
}

exports.getBest = async function ({subject, author} = {}) {
  // TODO
  // while the archivesdb is more recent, it won't have the thumbnail
  // -prf
  // check archivesDb meta
  // var meta = await archivesDb.getMeta(subject)
  // if (meta) {
  //   return _pick(meta, ['title', 'description', 'type'])
  // }

  // check for descriptions
  var descriptions = await list({subject, author})
  return _pick(descriptions[0] || {}, ['title', 'description', 'type', 'author'])
}

const get = exports.get = async function (url, pathname = undefined) {
  // validate & parse params
  if (url) {
    try { url = new URL(url) }
    catch (e) { throw new Error('Failed to parse post URL: ' + url) }
  }
  pathname = pathname || url.pathname

  // execute query
  return massageSiteDescriptionRow(await db.get(`
    SELECT
        crawl_site_descriptions.*, src.url AS crawlSourceUrl
      FROM crawl_site_descriptions
      INNER JOIN crawl_sources src
        ON src.id = crawl_site_descriptions.crawlSourceId
        AND src.url = ?
      WHERE
        crawl_site_descriptions.pathname = ?
  `, [url.origin, pathname]))
}

exports.capture = async function (archive, subjectArchive) {
  if (typeof subjectArchive === 'string') {
    subjectArchive = await dat.library.getOrLoadArchive(subjectArchive)
  }

  // capture metadata
  try {
    var info = JSON.parse(await subjectArchive.pda.readFile('/dat.json'))
  } catch (e) {
    console.error('Failed to read dat.json of subject archive', e)
    debug('Failed to read dat.json of subject archive', e)
    throw new Error('Unabled to read subject dat.json')
  }
  await put(archive, {
    subject: subjectArchive.url,
    title: typeof info.title === 'string' ? info.title : undefined,
    description: typeof info.description === 'string' ? info.description : undefined,
    type: typeof info.type === 'string' || (Array.isArray(info.type) && info.type.every(isString)) ? info.type : undefined
  })

  // capture thumb
  for (let ext of ['jpg', 'jpeg', 'png']) {
    let thumbPath = `/thumb.${ext}`
    if (await fileExists(subjectArchive, thumbPath)) {
      let targetPath = `/data/known_sites/${toHostname(subjectArchive.url)}.${ext}`
      await archive.pda.writeFile(targetPath, await subjectArchive.pda.readFile(thumbPath, 'binary'), 'binary')
      break
    }
  }
}

const put =
exports.put = async function (archive, {subject, title, description, type} = {}) {
  assert(typeof subject === 'string', 'Put() must be provided a `subject` string')
  try {
    var subjectUrl = new URL(subject)
  } catch (e) {
    throw new Error('Put() `subject` must be a valid URL')
  }
  assert(!title || typeof title === 'string', 'Put() `title` must be a string')
  assert(!description || typeof description === 'string', 'Put() `description` must be a string')
  if (type) {
    if (typeof type === 'string') type = type.split(',')
    assert(Array.isArray(type), 'Put() `type` must be a string or an array of strings')
    assert(type.every(isString), 'Put() `type` must be a string or an array of strings')
  }
  await ensureDirectory(archive, '/data')
  await ensureDirectory(archive, '/data/known_sites')
  await archive.pda.writeFile(`/data/known_sites/${subjectUrl.hostname}.json`, JSON.stringify({
    type: JSON_TYPE,
    subject: subjectUrl.toString(),
    metadata: {
      title,
      description,
      type
    },
    createdAt: (new Date()).toISOString()
  }))
  await crawler.crawlSite(archive)
}

exports.delete = async function (archive, pathname) {
  assert(typeof pathname === 'string', 'Delete() must be provided a valid URL string')
  await archive.pda.unlink(pathname)
  await crawler.crawlSite(archive)
}

// internal methods
// =

function isString (v) {
  return typeof v === 'string'
}

function toOrigin (url) {
  url = new URL(url)
  return url.protocol + '//' + url.hostname
}

function toHostname (url) {
  url = new URL(url)
  return url.hostname
}

async function ensureDirectory (archive, pathname) {
  try { await archive.pda.mkdir(pathname) }
  catch (e) { /* ignore */ }
}

async function fileExists (archive, pathname) {
  try { await archive.pda.stat(pathname) }
  catch (e) { return false }
  return true
}

function massageSiteDescriptionRow (row) {
  if (!row) return null
  row.author = {url: row.crawlSourceUrl}
  row.type = row.type && typeof row.type === 'string' ? row.type.split(',') : undefined
  delete row.crawlSourceUrl
  delete row.crawlSourceId
  return row
}
