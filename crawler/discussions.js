const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const Ajv = require('ajv')
const logger = require('../logger').child({category: 'crawler', dataset: 'discussions'})
const db = require('../dbs/profile-data-db')
const crawler = require('./index')
const datLibrary = require('../dat/library')
const lock = require('../lib/lock')
const knex = require('../lib/knex')
const siteDescriptions = require('./site-descriptions')
const {doCrawl, doCheckpoint, emitProgressEvent, getMatchingChangesInOrder, generateTimeFilename, ensureDirectory} = require('./util')
const discussionSchema = require('./json-schemas/discussion')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/discussion'
const JSON_PATH_REGEX = /^\/data\/discussions\/([^/]+)\.json$/i

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef { import("./site-descriptions").SiteDescription } SiteDescription
 *
 * @typedef {Object} Discussion
 * @prop {string} pathname
 * @prop {string} title
 * @prop {string} body
 * @prop {string} href
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
const validateDiscussion = ajv.compile(discussionSchema)

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for discussions.
 *
 * @param {DaemonDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_discussions', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling discussions', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_discussions WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_discussions', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed discussions
    var changedDiscussions = getMatchingChangesInOrder(changes, JSON_PATH_REGEX)
    if (changedDiscussions.length) {
      logger.verbose('Collected new/changed discussion files', {details: {url: archive.url, changedDiscussions: changedDiscussions.map(p => p.name)}})
    } else {
      logger.debug('No new discussion-files found', {details: {url: archive.url}})
    }
    emitProgressEvent(archive.url, 'crawl_discussions', 0, changedDiscussions.length)

    // read and apply each discussion in order
    var progress = 0
    for (let changedDiscussion of changedDiscussions) {
      // TODO Currently the crawler will abort reading the feed if any discussion fails to load
      //      this means that a single unreachable file can stop the forward progress of discussion indexing
      //      to solve this, we need to find a way to tolerate unreachable discussion-files without losing our ability to efficiently detect new discussions
      //      -prf
      if (changedDiscussion.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_discussions WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedDiscussion.name])
        events.emit('discussion-removed', archive.url)
      } else {
        // read
        let discussionString
        try {
          discussionString = await archive.pda.readFile(changedDiscussion.name, 'utf8')
        } catch (err) {
          logger.warn('Failed to read discussion file, aborting', {details: {url: archive.url, name: changedDiscussion.name, err}})
          return // abort indexing
        }

        // parse and validate
        let discussion
        try {
          discussion = JSON.parse(discussionString)
          let valid = validateDiscussion(discussion)
          if (!valid) throw ajv.errorsText(validateDiscussion.errors)
        } catch (err) {
          logger.warn('Failed to parse discussion file, skipping', {details: {url: archive.url, name: changedDiscussion.name, err}})
          continue // skip
        }

        // massage the discussion
        discussion.createdAt = Number(new Date(discussion.createdAt))
        discussion.updatedAt = Number(new Date(discussion.updatedAt))
        if (!discussion.title) discussion.title = '' // optional
        if (!discussion.href) discussion.href = '' // optional
        if (!discussion.tags) discussion.tags = [] // optional
        if (isNaN(discussion.updatedAt)) discussion.updatedAt = 0 // optional

        // upsert
        let discussionId = 0
        let existingDiscussion = await db.get(knex('crawl_discussions')
          .select('id')
          .where({
            crawlSourceId: crawlSource.id,
            pathname: changedDiscussion.name
          })
        )
        if (existingDiscussion) {
          let res = await db.run(knex('crawl_discussions')
            .where({
              crawlSourceId: crawlSource.id,
              pathname: changedDiscussion.name
            }).update({
              crawledAt: Date.now(),
              title: discussion.title,
              body: discussion.body,
              href: discussion.href,
              createdAt: discussion.createdAt,
              updatedAt: discussion.updatedAt,
            })
          )
          discussionId = existingDiscussion.id
          events.emit('discussion-updated', archive.url)
        } else {
          let res = await db.run(knex('crawl_discussions')
            .insert({
              crawlSourceId: crawlSource.id,
              pathname: changedDiscussion.name,
              crawledAt: Date.now(),
              title: discussion.title,
              body: discussion.body,
              href: discussion.href,
              createdAt: discussion.createdAt,
              updatedAt: discussion.updatedAt,
            })
          )
          discussionId = +res.lastID
          events.emit('discussion-added', archive.url)
        }
        await db.run(`DELETE FROM crawl_discussions_tags WHERE crawlDiscussionId = ?`, [discussionId])
        for (let tag of discussion.tags) {
          await db.run(`INSERT OR IGNORE INTO crawl_tags (tag) VALUES (?)`, [tag])
          let tagRow = await db.get(`SELECT id FROM crawl_tags WHERE tag = ?`, [tag])
          await db.run(`INSERT INTO crawl_discussions_tags (crawlDiscussionId, crawlTagId) VALUES (?, ?)`, [discussionId, tagRow.id])
        }
      }

      // checkpoint our progress
      await doCheckpoint('crawl_discussions', TABLE_VERSION, crawlSource, changedDiscussion.version)
      emitProgressEvent(archive.url, 'crawl_discussions', ++progress, changedDiscussions.length)
    }
    logger.silly(`Finished crawling discussions`, {details: {url: archive.url}})
  })
}

/**
 * @description
 * List crawled discussions.
 *
  * @param {Object} [opts]
  * @param {Object} [opts.filters]
  * @param {string|string[]} [opts.filters.authors]
  * @param {string|string[]} [opts.filters.tags]
  * @param {string} [opts.filters.visibility]
  * @param {string} [opts.sortBy]
  * @param {number} [opts.offset=0]
  * @param {number} [opts.limit]
  * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Discussion>>}
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
      opts.filters.authors = await Promise.all(opts.filters.authors.map(datLibrary.getPrimaryUrl))
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
  var sql = knex('crawl_discussions')
    .select('crawl_discussions.*')
    .select('crawl_sources.url as crawlSourceUrl')
    .select(knex.raw('group_concat(crawl_tags.tag, ",") as tags'))
    .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_discussions.crawlSourceId')
    .leftJoin('crawl_discussions_tags', 'crawl_discussions_tags.crawlDiscussionId', '=', 'crawl_discussions.id')
    .leftJoin('crawl_tags', 'crawl_discussions_tags.crawlTagId', '=', 'crawl_tags.id')
    .groupBy('crawl_discussions.id')
    .orderBy('crawl_discussions.createdAt', opts.reverse ? 'DESC' : 'ASC')
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }
  if (opts && opts.limit) sql = sql.limit(opts.limit)
  if (opts && opts.offset) sql = sql.offset(opts.offset)

  // execute query
  var rows = await db.all(sql)
  var discussions = await Promise.all(rows.map(massageDiscussionRow))

  // apply tags filter
  if (opts && opts.filters && opts.filters.tags) {
    const someFn = t => opts.filters.tags.includes(t)
    discussions = discussions.filter(discussion => discussion.tags.some(someFn))
  }

  return discussions
}

/**
 * @description
 * Get crawled discussion.
 *
 * @param {string} url - The URL of the discussion
 * @returns {Promise<Discussion>}
 */
const get = exports.get = async function (url) {
  // validate & parse params
  var urlParsed
  if (url) {
    try { urlParsed = new URL(url) }
    catch (e) { throw new Error('Invalid URL: ' + url) }
  }

  // build query
  var sql = knex('crawl_discussions')
    .select('crawl_discussions.*')
    .select('crawl_sources.url as crawlSourceUrl')
    .select(knex.raw('group_concat(crawl_tags.tag, ",") as tags'))
    .innerJoin('crawl_sources', function () {
      this.on('crawl_sources.id', '=', 'crawl_discussions.crawlSourceId')
        .andOn('crawl_sources.url', '=', knex.raw('?', `${urlParsed.protocol}//${urlParsed.hostname}`))
    })
    .leftJoin('crawl_discussions_tags', 'crawl_discussions_tags.crawlDiscussionId', '=', 'crawl_discussions.id')
    .leftJoin('crawl_tags', 'crawl_tags.id', '=', 'crawl_discussions_tags.crawlTagId')
    .where('crawl_discussions.pathname', urlParsed.pathname)
    .groupBy('crawl_discussions.id')

  // execute query
  return await massageDiscussionRow(await db.get(sql))
}

/**
 * @description
 * Create a new discussion.
 *
 * @param {DaemonDatArchive} archive - where to write the discussion to.
 * @param {Object} discussion
 * @param {string} discussion.title
 * @param {string} discussion.body
 * @param {string} discussion.href
 * @param {string[]} discussion.tags
 * @param {string} discussion.visibility
 * @returns {Promise<string>} url
 */
exports.add = async function (archive, discussion) {
  // TODO visibility

  var discussionObject = {
    type: JSON_TYPE,
    title: discussion.title,
    body: discussion.body,
    href: discussion.href,
    tags: discussion.tags,
    createdAt: (new Date()).toISOString()
  }
  var valid = validateDiscussion(discussionObject)
  if (!valid) throw ajv.errorsText(validateDiscussion.errors)

  var filename = generateTimeFilename()
  var filepath = `/data/discussions/${filename}.json`
  await ensureDirectory(archive, '/data')
  await ensureDirectory(archive, '/data/discussions')
  await archive.pda.writeFile(filepath, JSON.stringify(discussionObject, null, 2))
  await crawler.crawlSite(archive)
  return archive.url + filepath
}

/**
 * @description
 * Update the content of an existing discussion.
 *
 * @param {DaemonDatArchive} archive - where to write the discussion to.
 * @param {string} pathname - the pathname of the discussion.
 * @param {Object} discussion
 * @param {string} [discussion.title]
 * @param {string} [discussion.body]
 * @param {string} [discussion.href]
 * @param {string[]} [discussion.tags]
 * @param {string} [discussion.visibility]
 * @returns {Promise<void>}
 */
exports.edit = async function (archive, pathname, discussion) {
  // TODO visibility

  var release = await lock('crawler:discussions:' + archive.url)
  try {
    // fetch discussion
    var existingDiscussion = await get(archive.url + pathname)
    if (!existingDiscussion) throw new Error('Discussion not found')

    // update discussion content
    var discussionObject = {
      type: JSON_TYPE,
      title: ('title' in discussion) ? discussion.title : existingDiscussion.title,
      body: ('body' in discussion) ? discussion.body : existingDiscussion.body,
      href: ('href' in discussion) ? discussion.href : existingDiscussion.href,
      tags: ('tags' in discussion) ? discussion.tags : existingDiscussion.tags,
      createdAt: existingDiscussion.createdAt,
      updatedAt: (new Date()).toISOString()
    }

    // validate
    var valid = validateDiscussion(discussionObject)
    if (!valid) throw ajv.errorsText(validateDiscussion.errors)

    // write
    await archive.pda.writeFile(pathname, JSON.stringify(discussionObject, null, 2))
    await crawler.crawlSite(archive)
  } finally {
    release()
  }
}

/**
 * @description
 * Delete an existing discussion
 *
 * @param {DaemonDatArchive} archive - where to write the discussion to.
 * @param {string} pathname - the pathname of the discussion.
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
 * @returns {Promise<Discussion>}
 */
async function massageDiscussionRow (row) {
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
    title: row.title,
    body: row.body,
    href: row.href,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    visibility: 'public' // TODO visibility
  }
}
