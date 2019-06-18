const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const Ajv = require('ajv')
const logger = require('../logger').child({category: 'crawler', dataset: 'media'})
const db = require('../dbs/profile-data-db')
const crawler = require('./index')
const lock = require('../lib/lock')
const knex = require('../lib/knex')
const siteDescriptions = require('./site-descriptions')
const {doCrawl, doCheckpoint, emitProgressEvent, getMatchingChangesInOrder, generateTimeFilename, ensureDirectory, toOrigin} = require('./util')
const mediaSchema = require('./json-schemas/media')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/media'
const JSON_PATH_REGEX = /^\/data\/media\/([^/]+)\.json$/i

// typedefs
// =

/**
 * @typedef {import('../dat/library').InternalDatArchive} InternalDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef { import("./site-descriptions").SiteDescription } SiteDescription
 *
 * @typedef {Object} Media
 * @prop {string} pathname
 * @prop {string} subtype
 * @prop {string} href
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} tags
 * @prop {string} createdAt
 * @prop {string} updatedAt
 * @prop {SiteDescription} author
 * @prop {string} visibility
 */

// globals
// =

const events = new Events()
const ajv = (new Ajv())
const validateMedia = ajv.compile(mediaSchema)

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for media.
 *
 * @param {InternalDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_media', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling media', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_media WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_media', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed media
    var changedMedia = getMatchingChangesInOrder(changes, JSON_PATH_REGEX)
    if (changedMedia.length) {
      logger.verbose('Collected new/changed media files', {details: {url: archive.url, changedMedia: changedMedia.map(p => p.name)}})
    } else {
      logger.debug('No new media-files found', {details: {url: archive.url}})
    }
    emitProgressEvent(archive.url, 'crawl_media', 0, changedMedia.length)

    // read and apply each media in order
    var progress = 0
    for (let changedMediaItem of changedMedia) {
      // TODO Currently the crawler will abort reading the feed if any media fails to load
      //      this means that a single unreachable file can stop the forward progress of media indexing
      //      to solve this, we need to find a way to tolerate unreachable media-files without losing our ability to efficiently detect new media
      //      -prf
      if (changedMediaItem.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_media WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedMediaItem.name])
        events.emit('media-removed', archive.url)
      } else {
        // read
        let mediaString
        try {
          mediaString = await archive.pda.readFile(changedMediaItem.name, 'utf8')
        } catch (err) {
          logger.warn('Failed to read media file, aborting', {details: {url: archive.url, name: changedMediaItem.name, err}})
          return // abort indexing
        }

        // parse and validate
        let media
        try {
          media = JSON.parse(mediaString)
          let valid = validateMedia(media)
          if (!valid) throw ajv.errorsText(validateMedia.errors)
        } catch (err) {
          logger.warn('Failed to parse media file, skipping', {details: {url: archive.url, name: changedMediaItem.name, err}})
          continue // skip
        }

        // massage the media
        media.createdAt = Number(new Date(media.createdAt))
        media.updatedAt = Number(new Date(media.updatedAt))
        if (!media.description) media.description = '' // optional
        if (!media.tags) media.tags = [] // optional
        if (isNaN(media.updatedAt)) media.updatedAt = 0 // optional

        // upsert
        let mediaId = 0
        let existingMedia = await db.get(knex('crawl_media')
          .select('id')
          .where({
            crawlSourceId: crawlSource.id,
            pathname: changedMediaItem.name
          })
        )
        if (existingMedia) {
          await db.run(knex('crawl_media')
            .where({
              crawlSourceId: crawlSource.id,
              pathname: changedMediaItem.name
            }).update({
              crawledAt: Date.now(),
              subtype: media.subtype,
              href: media.href,
              title: media.title,
              description: media.description,
              createdAt: media.createdAt,
              updatedAt: media.updatedAt,
            })
          )
          mediaId = existingMedia.id
          events.emit('media-updated', archive.url)
        } else {
          let res = await db.run(knex('crawl_media')
            .insert({
              crawlSourceId: crawlSource.id,
              pathname: changedMediaItem.name,
              crawledAt: Date.now(),
              subtype: media.subtype,
              href: media.href,
              title: media.title,
              description: media.description,
              createdAt: media.createdAt,
              updatedAt: media.updatedAt,
            })
          )
          mediaId = +res.lastID
          events.emit('media-added', archive.url)
        }
        await db.run(`DELETE FROM crawl_media_tags WHERE crawlMediaId = ?`, [mediaId])
        for (let tag of media.tags) {
          await db.run(`INSERT OR IGNORE INTO crawl_tags (tag) VALUES (?)`, [tag])
          let tagRow = await db.get(`SELECT id FROM crawl_tags WHERE tag = ?`, [tag])
          await db.run(`INSERT INTO crawl_media_tags (crawlMediaId, crawlTagId) VALUES (?, ?)`, [mediaId, tagRow.id])
        }
      }

      // checkpoint our progress
      await doCheckpoint('crawl_media', TABLE_VERSION, crawlSource, changedMediaItem.version)
      emitProgressEvent(archive.url, 'crawl_media', ++progress, changedMedia.length)
    }
    logger.silly(`Finished crawling media`, {details: {url: archive.url}})
  })
}

/**
 * @description
 * List crawled media.
 *
  * @param {Object} [opts]
  * @param {Object} [opts.filters]
  * @param {string|string[]} [opts.filters.authors]
  * @param {string|string[]} [opts.filters.hrefs]
  * @param {string|string[]} [opts.filters.subtypes]
  * @param {string|string[]} [opts.filters.tags]
  * @param {string} [opts.filters.visibility]
  * @param {string} [opts.sortBy]
  * @param {number} [opts.offset=0]
  * @param {number} [opts.limit]
  * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Media>>}
 */
exports.list = async function (opts) {
  // TODO: handle visibility
  // TODO: sortBy options

  // validate & parse params
  if (opts && 'sortBy' in opts) assert(typeof opts.sortBy === 'number', 'SortBy must be a string')
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
      opts.filters.authors = opts.filters.authors.map(url => toOrigin(url, true))
    }
    if ('hrefs' in opts.filters) {
      if (Array.isArray(opts.filters.hrefs)) {
        assert(opts.filters.hrefs.every(v => typeof v === 'string'), 'Hrefs filter must be a string or array of strings')
      } else {
        assert(typeof opts.filters.hrefs === 'string', 'Hrefs filter must be a string or array of strings')
        opts.filters.hrefs = [opts.filters.hrefs]
      }
    }
    if ('subtypes' in opts.filters) {
      if (Array.isArray(opts.filters.subtypes)) {
        assert(opts.filters.subtypes.every(v => typeof v === 'string'), 'Subtypes filter must be a string or array of strings')
      } else {
        assert(typeof opts.filters.subtypes === 'string', 'Subtypes filter must be a string or array of strings')
        opts.filters.subtypes = [opts.filters.subtypes]
      }
    }
    if ('tags' in opts.filters) {
      if (Array.isArray(opts.filters.tags)) {
        assert(opts.filters.tags.every(v => typeof v === 'string'), 'Tags filter must be a string or array of strings')
      } else {
        assert(typeof opts.filters.tags === 'string', 'Tags filter must be a string or array of strings')
        opts.filters.tags = [opts.filters.tags]
      }
    }
  }

  // build query
  var sql = knex('crawl_media')
    .select('crawl_media.*')
    .select('crawl_sources.url as crawlSourceUrl')
    .select(knex.raw('group_concat(crawl_tags.tag, ",") as tags'))
    .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_media.crawlSourceId')
    .leftJoin('crawl_media_tags', 'crawl_media_tags.crawlMediaId', '=', 'crawl_media.id')
    .leftJoin('crawl_tags', 'crawl_media_tags.crawlTagId', '=', 'crawl_tags.id')
    .groupBy('crawl_media.id')
    .orderBy('crawl_media.createdAt', opts.reverse ? 'DESC' : 'ASC')
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }
  if (opts && opts.filters && opts.filters.hrefs) {
    sql = sql.whereIn('crawl_media.href', opts.filters.hrefs)
  }
  if (opts && opts.filters && opts.filters.subtypes) {
    sql = sql.whereIn('crawl_media.subtype', opts.filters.subtypes)
  }
  if (opts && opts.filters && opts.filters.tags) {
    sql = sql.whereIn('crawl_tags.tag', opts.filters.tags)
  }
  if (opts && opts.limit) sql = sql.limit(opts.limit)
  if (opts && opts.offset) sql = sql.offset(opts.offset)

  // execute query
  var rows = await db.all(sql)
  return Promise.all(rows.map(massageMediaRow))
}

/**
 * @description
 * Get crawled media.
 *
 * @param {string} url - The URL of the media
 * @returns {Promise<Media>}
 */
const get = exports.get = async function (url) {
  // validate & parse params
  var urlParsed
  if (url) {
    try { urlParsed = new URL(url) }
    catch (e) { throw new Error('Invalid URL: ' + url) }
  }

  // build query
  var sql = knex('crawl_media')
    .select('crawl_media.*')
    .select('crawl_sources.url as crawlSourceUrl')
    .select(knex.raw('group_concat(crawl_tags.tag, ",") as tags'))
    .innerJoin('crawl_sources', function () {
      this.on('crawl_sources.id', '=', 'crawl_media.crawlSourceId')
        .andOn('crawl_sources.url', '=', knex.raw('?', `${urlParsed.protocol}//${urlParsed.hostname}`))
    })
    .leftJoin('crawl_media_tags', 'crawl_media_tags.crawlMediaId', '=', 'crawl_media.id')
    .leftJoin('crawl_tags', 'crawl_tags.id', '=', 'crawl_media_tags.crawlTagId')
    .where('crawl_media.pathname', urlParsed.pathname)
    .groupBy('crawl_media.id')

  // execute query
  return await massageMediaRow(await db.get(sql))
}

/**
 * @description
 * Create a new media.
 *
 * @param {InternalDatArchive} archive - where to write the media to.
 * @param {Object} media
 * @param {string} media.subtype
 * @param {string} media.href
 * @param {string} media.title
 * @param {string} media.description
 * @param {string[]} media.tags
 * @param {string} media.visibility
 * @returns {Promise<string>} url
 */
exports.add = async function (archive, media) {
  // TODO visibility

  var mediaObject = {
    type: JSON_TYPE,
    subtype: media.subtype,
    href: media.href,
    title: media.title,
    description: media.description,
    tags: media.tags,
    createdAt: (new Date()).toISOString()
  }
  var valid = validateMedia(mediaObject)
  if (!valid) throw ajv.errorsText(validateMedia.errors)

  var filename = generateTimeFilename()
  var filepath = `/data/media/${filename}.json`
  await ensureDirectory(archive, '/data')
  await ensureDirectory(archive, '/data/media')
  await archive.pda.writeFile(filepath, JSON.stringify(mediaObject, null, 2))
  await crawler.crawlSite(archive)
  return archive.url + filepath
}

/**
 * @description
 * Update the content of an existing media.
 *
 * @param {InternalDatArchive} archive - where to write the media to.
 * @param {string} pathname - the pathname of the media.
 * @param {Object} media
 * @param {string} [media.subtype]
 * @param {string} [media.href]
 * @param {string} [media.title]
 * @param {string} [media.description]
 * @param {string[]} [media.tags]
 * @param {string} [media.visibility]
 * @returns {Promise<void>}
 */
exports.edit = async function (archive, pathname, media) {
  // TODO visibility

  var release = await lock('crawler:media:' + archive.url)
  try {
    // fetch media
    var existingMedia = await get(archive.url + pathname)
    if (!existingMedia) throw new Error('Media not found')

    // update media content
    var mediaObject = {
      type: JSON_TYPE,
      subtype: ('subtype' in media) ? media.subtype : existingMedia.subtype,
      href: ('href' in media) ? media.href : existingMedia.href,
      title: ('title' in media) ? media.title : existingMedia.title,
      description: ('description' in media) ? media.description : existingMedia.description,
      tags: ('tags' in media) ? media.tags : existingMedia.tags,
      createdAt: existingMedia.createdAt,
      updatedAt: (new Date()).toISOString()
    }

    // validate
    var valid = validateMedia(mediaObject)
    if (!valid) throw ajv.errorsText(validateMedia.errors)

    // write
    await archive.pda.writeFile(pathname, JSON.stringify(mediaObject, null, 2))
    await crawler.crawlSite(archive)
  } finally {
    release()
  }
}

/**
 * @description
 * Delete an existing media
 *
 * @param {InternalDatArchive} archive - where to write the media to.
 * @param {string} pathname - the pathname of the media.
 * @returns {Promise<void>}
 */
exports.remove = async function (archive, pathname) {
  assert(typeof pathname === 'string', 'Remove() must be provided a valid URL string')
  await archive.pda.unlink(pathname)
  await crawler.crawlSite(archive)
}

// internal methods
// =

/**
 * @param {Object} row
 * @returns {Promise<Media>}
 */
async function massageMediaRow (row) {
  if (!row) return null
  var author = await siteDescriptions.getBest({subject: row.crawlSourceUrl})
  if (!author) {
    author = {
      url: row.crawlSourceUrl,
      title: '',
      description: '',
      type: [],
      thumbUrl: `${row.crawlSourceUrl}/thumb`,
      descAuthor: {url: null}
    }
  }
  return {
    pathname: row.pathname,
    author,
    subtype: row.subtype,
    href: row.href,
    title: row.title,
    description: row.description,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    visibility: 'public' // TODO visibility
  }
}
