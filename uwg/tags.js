const assert = require('assert')
const {URL} = require('url')
const db = require('../dbs/profile-data-db')
const knex = require('../lib/knex')
const datArchives = require('../dat/archives')
const {normalizeSchemaUrl} = require('./util')

// typedefs
// =

/**
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef { import("./site-descriptions").SiteDescription } SiteDescription
 *
 * @typedef {Object} Tag
 * @prop {string} tag
 * @prop {number} count
 */

// exported api
// =

/**
 * @description
 * List bookmark tags.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.filters]
 * @param {string|string[]} [opts.filters.authors]
 * @param {string} [opts.filters.visibility]
 * @param {string} [opts.sortBy]
 * @param {number} [opts.offset=0]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Tag>>}
 */
exports.listBookmarkTags = async function (opts) {
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
  var sql = knex('crawl_tags')
    .select('crawl_tags.tag')
    .select(knex.raw('count(crawl_tags.id) as count'))
    .innerJoin('crawl_bookmarks_tags', 'crawl_bookmarks_tags.crawlTagId', '=', 'crawl_tags.id')
    .innerJoin('crawl_bookmarks', 'crawl_bookmarks_tags.crawlBookmarkId', '=', 'crawl_bookmarks.id')
    .leftJoin('crawl_sources', 'crawl_bookmarks.crawlSourceId', '=', 'crawl_sources.id')
    .orderBy('crawl_tags.tag', opts.reverse ? 'DESC' : 'ASC')
    .groupBy('crawl_tags.tag')
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }
  if (opts && opts.limit) sql = sql.limit(opts.limit)
  if (opts && opts.offset) sql = sql.offset(opts.offset)

  // execute query
  var rows = await db.all(sql)
  return rows.map(row => ({
    tag: row.tag,
    count: +row.count
  }))
}

/**
 * @description
 * List discussion tags.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.filters]
 * @param {string|string[]} [opts.filters.authors]
 * @param {string} [opts.filters.visibility]
 * @param {string} [opts.sortBy]
 * @param {number} [opts.offset=0]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Tag>>}
 */
exports.listDiscussionTags = async function (opts) {
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
  var sql = knex('crawl_tags')
    .select('crawl_tags.tag')
    .select(knex.raw('count(crawl_tags.id) as count'))
    .innerJoin('crawl_discussions_tags', 'crawl_discussions_tags.crawlTagId', '=', 'crawl_tags.id')
    .innerJoin('crawl_discussions', 'crawl_discussions_tags.crawlDiscussionId', '=', 'crawl_discussions.id')
    .leftJoin('crawl_sources', 'crawl_discussions.crawlSourceId', '=', 'crawl_sources.id')
    .orderBy('crawl_tags.tag', opts.reverse ? 'DESC' : 'ASC')
    .groupBy('crawl_tags.tag')
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }
  if (opts && opts.limit) sql = sql.limit(opts.limit)
  if (opts && opts.offset) sql = sql.offset(opts.offset)

  // execute query
  var rows = await db.all(sql)
  return rows.map(row => ({
    tag: row.tag,
    count: +row.count
  }))
}

/**
 * @description
 * List media tags.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.filters]
 * @param {string|string[]} [opts.filters.authors]
 * @param {string|string[]} [opts.filters.subtypes]
 * @param {string} [opts.filters.visibility]
 * @param {string} [opts.sortBy]
 * @param {number} [opts.offset=0]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Tag>>}
 */
exports.listMediaTags = async function (opts) {
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
    if ('subtypes' in opts.filters) {
      if (Array.isArray(opts.filters.subtypes)) {
        assert(opts.filters.subtypes.every(v => typeof v === 'string'), 'Subtypes filter must be a string or array of strings')
      } else {
        assert(typeof opts.filters.subtypes === 'string', 'Subtypes filter must be a string or array of strings')
        opts.filters.subtypes = [opts.filters.subtypes]
      }
      opts.filters.subtypes = opts.filters.subtypes.map(normalizeSchemaUrl)
    }
    if ('visibility' in opts.filters) {
      assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
    }
  }

  // build query
  var sql = knex('crawl_tags')
    .select('crawl_tags.tag')
    .select(knex.raw('count(crawl_tags.id) as count'))
    .innerJoin('crawl_media_tags', 'crawl_media_tags.crawlTagId', '=', 'crawl_tags.id')
    .innerJoin('crawl_media', 'crawl_media_tags.crawlMediaId', '=', 'crawl_media.id')
    .leftJoin('crawl_sources', 'crawl_media.crawlSourceId', '=', 'crawl_sources.id')
    .orderBy('crawl_tags.tag', opts.reverse ? 'DESC' : 'ASC')
    .groupBy('crawl_tags.tag')
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }
  if (opts && opts.filters && opts.filters.subtypes) {
    sql = sql.whereIn('crawl_media.subtype', opts.filters.subtypes)
  }
  if (opts && opts.limit) sql = sql.limit(opts.limit)
  if (opts && opts.offset) sql = sql.offset(opts.offset)

  // execute query
  var rows = await db.all(sql)
  return rows.map(row => ({
    tag: row.tag,
    count: +row.count
  }))
}