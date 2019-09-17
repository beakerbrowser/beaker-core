const _groupBy = require('lodash.groupby')
const _uniqWith = require('lodash.uniqwith')
const db = require('../dbs/profile-data-db')
const historyDb = require('../dbs/history')
const datArchives = require('../dat/archives')
const filesystem = require('../filesystem')
const datLibrary = require('../filesystem/dat-library')
const follows = require('./follows')
const bookmarks = require('./bookmarks')
const knex = require('../lib/knex')
const libTools = require('@beaker/library-tools')

const SITE_TYPES = Object.values(libTools.getCategoriesMap()).filter(Boolean)

// typedefs
// =

/**
 * @typedef {import("../filesystem/dat-library").LibraryDat} LibraryDat
 *
 * @typedef {Object} SuggestionResults
 * @prop {Array<Object>} bookmarks
 * @prop {(undefined|Array<Object>)} history
 * @prop {Array<Object>} modules
 * @prop {Array<Object>} people
 * @prop {Array<Object>} templates
 * @prop {Array<Object>} themes
 * @prop {Array<Object>} websites
 *
 * TODO: define the SuggestionResults values
 *
 * @typedef {Object} SearchResults
 * @prop {number} highlightNonce - A number used to create perimeters around text that should be highlighted.
 * @prop {Array<SiteSearchResult|PostSearchResult>} results
 *
 * @typedef {Object} SearchResultAuthor
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string} type
 *
 * @typedef {Object} SearchResultRecord
 * @prop {string} type
 * @prop {string} url
 * @prop {number} crawledAt
 * @prop {SearchResultAuthor} author
 *
 * @typedef {Object} SiteSearchResult
 * @prop {SearchResultRecord} record
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string} type
 *
 * @typedef {Object} PostSearchResult
 * @prop {SearchResultRecord} record
 * @prop {string} url
 * @prop {Object} content
 * @prop {string} content.body
 * @prop {number} createdAt
 * @prop {number} updatedAt
 *
 * @typedef {Object} BookmarkSearchResult
 * @prop {SearchResultRecord} record
 * @prop {string} url
 * @prop {Object} content
 * @prop {string} content.href
 * @prop {string} content.title
 * @prop {string} content.description
 * @prop {number} createdAt
 * @prop {number} updatedAt
 */

// exported api
// =

/**
 * @description
 * Get suggested content of various types.
 *
 * @param {string} user - The current user's URL.
 * @param {string} [query=''] - The search query.
 * @param {Object} [opts={}]
 * @returns {Promise<SuggestionResults>}
 */
exports.listSuggestions = async function (user, query = '', opts = {}) {
  var suggestions = {
    bookmarks: [],
    history: undefined,
    modules: [],
    people: [],
    templates: [],
    themes: [],
    websites: []
  }
  const filterFn = a => query ? ((a.url || a.href).includes(query) || a.title.toLowerCase().includes(query)) : true
  const sortFn = (a, b) => (a.title||'').localeCompare(b.title||'')
  function dedup (arr) {
    var hits = new Set()
    return arr.filter(item => {
      if (hits.has(item.url)) return false
      hits.add(item.url)
      return true
    })
  }

  // bookmarks
  var bookmarkResults = await bookmarks.list({
    author: [filesystem.get().url, user]
  })
  bookmarkResults = bookmarkResults.filter(filterFn)
  bookmarkResults.sort(sortFn)
  bookmarkResults = bookmarkResults.slice(0, 12)
  suggestions.bookmarks = bookmarkResults.map(b => ({title: b.title, url: b.href}))

  // modules
  suggestions.modules = (await datLibrary.list({type: 'unwalled.garden/module'})).map(site => ({title: site.meta.title, url: `dat://${site.key}`}))
  suggestions.modules = suggestions.modules.filter(filterFn)
  suggestions.modules.sort(sortFn)

  // people
  suggestions.people = (await follows.list({author: user})).map(({topic}) => topic)
  suggestions.people = (await datLibrary.list({type: 'unwalled.garden/person'}))
    .map(site => ({title: site.meta.title, url: `dat://${site.key}`}))
    .concat(suggestions.people)
  suggestions.people = dedup(suggestions.people)
  suggestions.people = suggestions.people.filter(filterFn)
  suggestions.people.sort(sortFn)

  // templates
  suggestions.templates = (await datLibrary.list({type: 'unwalled.garden/template'})).map(site => ({title: site.meta.title, url: `dat://${site.key}`}))
  suggestions.templates = suggestions.templates.filter(filterFn)
  suggestions.templates.sort(sortFn)
  suggestions.templates = suggestions.templates.map(site => ({title: site.meta.title, url: site.meta.url}))

  // themes
  suggestions.themes = (await datLibrary.list({type: 'unwalled.garden/theme'})).map(site => ({title: site.meta.title, url: `dat://${site.key}`}))
  suggestions.themes = suggestions.themes.filter(filterFn)
  suggestions.themes.sort(sortFn)

  // websites
  suggestions.websites = (await datLibrary.list())
    .filter(w => (!w.meta.type || !SITE_TYPES.includes(w.meta.type))) // filter out other site types
    .map(site => ({title: site.meta.title, url: `dat://${site.key}`}))
  suggestions.websites = suggestions.websites.filter(filterFn)
  suggestions.websites.sort(sortFn)

  if (query) {
    // history
    var historyResults = await historyDb.search(query)
    suggestions.history = historyResults.slice(0, 12)
    suggestions.history.sort((a, b) => a.url.length - b.url.length) // shorter urls at top
  }

  return suggestions
}

/**
 * @description
 * Run a search query against crawled data.
 *
 * @param {string} user - The current user's URL.
 * @param {Object} opts
 * @param {string} [opts.query] - The search query.
 * @param {Object} [opts.filters]
 * @param {string|string[]} [opts.filters.datasets] - Filter results to the given datasets. Defaults to 'all'. Valid values: 'all', 'sites', 'unwalled.garden/post', 'unwalled.garden/bookmark'.
 * @param {number} [opts.filters.since] - Filter results to items created since the given timestamp.
 * @param {number} [opts.hops=1] - How many hops out in the user's follow graph should be included? Valid values: 1, 2.
 * @param {number} [opts.offset]
 * @param {number} [opts.limit = 20]
 * @returns {Promise<SearchResults>}
 */
exports.query = async function (user, opts) {
  const highlightNonce =  (Math.random() * 1e3)|0
  const startHighlight = `{${highlightNonce}}`
  const endHighlight = `{/${highlightNonce}}`

  var searchResults = {
    highlightNonce,
    results: []
  }
  var {query, hops, filters, offset, limit} = Object.assign({}, {
    query: undefined,
    hops: 1,
    filters: {},
    offset: 0,
    limit: 20
  }, opts)
  var {datasets, since} = Object.assign({}, {
    datasets: 'all',
    since: 0
  }, filters)
  hops = Math.min(Math.max(Math.floor(hops), 1), 2) // clamp to [1, 2] for now
  var datasetValues = (typeof datasets === 'undefined')
    ? ['all']
    : Array.isArray(datasets) ? datasets : [datasets]

  // prep search terms
  if (query && typeof query === 'string') {
    query = query
      .replace(/[^a-z0-9]/ig, ' ') // strip symbols that sqlite interprets.
      .toLowerCase() // all lowercase. (uppercase is interpretted as a directive by sqlite.)
    query += '*' // match prefixes
  }

  // get user's crawl_source id
  var userCrawlSourceId
  {
    let res = await db.get(`SELECT id FROM crawl_sources WHERE url = ?`, [user])
    userCrawlSourceId = res.id
  }

  // construct set of crawl sources to query
  var crawlSourceIds
  if (hops === 2) {
    // the user and all followed sources
    let res = await db.all(`
      SELECT id FROM crawl_sources src
        INNER JOIN crawl_follows follows ON follows.destUrl = src.url AND follows.crawlSourceId = ?
    `, [userCrawlSourceId])
    crawlSourceIds = [userCrawlSourceId].concat(res.map(({id}) => id))
  } else if (hops === 1) {
    // just the user
    crawlSourceIds = [userCrawlSourceId]
  }

  // run queries
  if (datasetValues.includes('all') || datasetValues.includes('sites')) {
    // SITES
    let rows = await db.all(buildSitesSearchQuery({
      query,
      crawlSourceIds,
      user,
      userCrawlSourceId,
      since,
      limit,
      offset,
      startHighlight,
      endHighlight
    }))
    rows = _uniqWith(rows, (a, b) => a.url === b.url) // remove duplicates
    rows = await Promise.all(rows.map(massageSiteSearchResult))
    searchResults.results = searchResults.results.concat(rows)
  }
  if (datasetValues.includes('all') || datasets.includes('unwalled.garden/post')) {
    // POSTS
    let rows = await db.all(buildPostsSearchQuery({
      query,
      crawlSourceIds,
      userCrawlSourceId,
      since,
      limit,
      offset,
      startHighlight,
      endHighlight
    }))
    rows = await Promise.all(rows.map(massagePostSearchResult))
    searchResults.results = searchResults.results.concat(rows)
  }
  if (datasetValues.includes('all') || datasets.includes('unwalled.garden/bookmark')) {
    // BOOKMARKS
    let rows = await db.all(buildBookmarksSearchQuery({
      query,
      crawlSourceIds,
      userCrawlSourceId,
      since,
      limit,
      offset,
      startHighlight,
      endHighlight
    }))
    rows = await Promise.all(rows.map(massageBookmarkSearchResult))
    searchResults.results = searchResults.results.concat(rows)
  }

  // sort and apply limit again
  searchResults.results.sort((a, b) => b.record.crawledAt - a.record.crawledAt)
  searchResults.results = searchResults.results.slice(0, limit)

  return searchResults
}

// internal methods
// =

function buildSitesSearchQuery ({query, crawlSourceIds, user, userCrawlSourceId, since, limit, offset, startHighlight, endHighlight}) {
  let sql = knex(query ? 'crawl_site_descriptions_fts_index' : 'crawl_site_descriptions')
    .select('crawl_site_descriptions.url AS url')
    .select('crawl_sources.url AS authorUrl')
    .select('crawl_site_descriptions.crawledAt')
    .where(builder => builder
      .whereIn('crawl_follows.crawlSourceId', crawlSourceIds) // description by a followed user
      .orWhere(builder => builder
        .where('crawl_site_descriptions.url', user) // about me and...
        .andWhere('crawl_site_descriptions.crawlSourceId', userCrawlSourceId) // by me
      )
    )
    .where('crawl_site_descriptions.crawledAt', '>=', since)
    .orderBy('crawl_site_descriptions.crawledAt')
    .limit(limit)
    .offset(offset)
  if (query) {
    sql = sql
      .select(knex.raw(`SNIPPET(crawl_site_descriptions_fts_index, 0, '${startHighlight}', '${endHighlight}', '...', 25) AS title`))
      .select(knex.raw(`SNIPPET(crawl_site_descriptions_fts_index, 1, '${startHighlight}', '${endHighlight}', '...', 25) AS description`))
      .innerJoin('crawl_site_descriptions', 'crawl_site_descriptions.rowid', '=', 'crawl_site_descriptions_fts_index.rowid')
      .leftJoin('crawl_follows', 'crawl_follows.destUrl', '=', 'crawl_site_descriptions.url')
      .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_site_descriptions.crawlSourceId')
      .whereRaw('crawl_site_descriptions_fts_index MATCH ?', [query])
  } else {
    sql = sql
      .select('crawl_site_descriptions.title')
      .select('crawl_site_descriptions.description')
      .leftJoin('crawl_follows', 'crawl_follows.destUrl', '=', 'crawl_site_descriptions.url')
      .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_site_descriptions.crawlSourceId')
  }
  return sql
}

function buildPostsSearchQuery ({query, crawlSourceIds, userCrawlSourceId, since, limit, offset, startHighlight, endHighlight}) {
  let sql = knex(query ? 'crawl_posts_fts_index' : 'crawl_posts')
    .select('crawl_posts.pathname')
    .select('crawl_posts.crawledAt')
    .select('crawl_posts.createdAt')
    .select('crawl_posts.updatedAt')
    .select('crawl_sources.url AS authorUrl')
    .where(builder => builder
      .whereIn('crawl_follows.crawlSourceId', crawlSourceIds) // published by someone I follow
      .orWhere('crawl_posts.crawlSourceId', userCrawlSourceId) // or by me
    )
    .andWhere('crawl_posts.crawledAt', '>=', since)
    .orderBy('crawl_posts.crawledAt')
    .limit(limit)
    .offset(offset)
  if (query) {
    sql = sql
      .select(knex.raw(`SNIPPET(crawl_posts_fts_index, 0, '${startHighlight}', '${endHighlight}', '...', 25) AS body`))
      .innerJoin('crawl_posts', 'crawl_posts.rowid', '=', 'crawl_posts_fts_index.rowid')
      .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_posts.crawlSourceId')
      .leftJoin('crawl_follows', 'crawl_follows.destUrl', '=', 'crawl_sources.url')
      .whereRaw('crawl_posts_fts_index MATCH ?', [query])
  } else {
    sql = sql
      .select('crawl_posts.body')
      .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_posts.crawlSourceId')
      .leftJoin('crawl_follows', 'crawl_follows.destUrl', '=', 'crawl_sources.url')
  }
  return sql
}

function buildBookmarksSearchQuery ({query, crawlSourceIds, userCrawlSourceId, since, limit, offset, startHighlight, endHighlight}) {
  let sql = knex(query ? 'crawl_bookmarks_fts_index' : 'crawl_bookmarks')
    .select('crawl_bookmarks.pathname')
    .select('crawl_bookmarks.crawledAt')
    .select('crawl_bookmarks.createdAt')
    .select('crawl_bookmarks.updatedAt')
    .select('crawl_sources.url AS authorUrl')
    .where(builder => builder
      .whereIn('crawl_follows.crawlSourceId', crawlSourceIds) // published by someone I follow
      .orWhere('crawl_bookmarks.crawlSourceId', userCrawlSourceId) // or by me
    )
    .andWhere('crawl_bookmarks.crawledAt', '>=', since)
    .orderBy('crawl_bookmarks.crawledAt')
    .limit(limit)
    .offset(offset)
  if (query) {
    sql = sql
      .select('crawl_bookmarks.href')
      .select(knex.raw(`SNIPPET(crawl_bookmarks_fts_index, 0, '${startHighlight}', '${endHighlight}', '...', 25) AS title`))
      .select(knex.raw(`SNIPPET(crawl_bookmarks_fts_index, 1, '${startHighlight}', '${endHighlight}', '...', 25) AS description`))
      .innerJoin('crawl_bookmarks', 'crawl_bookmarks.rowid', '=', 'crawl_bookmarks_fts_index.rowid')
      .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_bookmarks.crawlSourceId')
      .leftJoin('crawl_follows', 'crawl_follows.destUrl', '=', 'crawl_sources.url')
      .whereRaw('crawl_bookmarks_fts_index MATCH ?', [query])
  } else {
    sql = sql
      .select('crawl_bookmarks.href')
      .select('crawl_bookmarks.title')
      .select('crawl_bookmarks.description')
      .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_bookmarks.crawlSourceId')
      .leftJoin('crawl_follows', 'crawl_follows.destUrl', '=', 'crawl_sources.url')
  }
  return sql
}

/**
 * @param {Object} row
 * @returns {Promise<SiteSearchResult>}
 */
async function massageSiteSearchResult (row) {
  // fetch additional info
  var author = await siteDescriptions.getBest({subject: row.authorUrl})

  // massage attrs
  return {
    record: {
      type: 'site',
      url: row.url,
      author: {
        url: author.url,
        title: author.title,
        description: author.description,
        type: author.type
      },
      crawledAt: row.crawledAt,
    },
    url: row.url,
    title: row.title,
    description: row.description,
    type: row.type
  }
}

/**
 * @param {Object} row
 * @returns {Promise<PostSearchResult>}
 */
async function massagePostSearchResult (row) {
  // fetch additional info
  var author = await siteDescriptions.getBest({subject: row.authorUrl})

  // massage attrs
  var url = row.authorUrl + row.pathname
  return {
    record: {
      type: 'unwalled.garden/post',
      url,
      author: {
        url: author.url,
        title: author.title,
        description: author.description,
        type: author.type
      },
      crawledAt: row.crawledAt,
    },
    url,
    content: {body: row.body},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/**
 * @param {Object} row
 * @returns {Promise<BookmarkSearchResult>}
 */
async function massageBookmarkSearchResult (row) {
  // fetch additional info
  var author = await siteDescriptions.getBest({subject: row.authorUrl})

  // massage attrs
  var url = row.authorUrl + row.pathname
  return {
    record: {
      type: 'unwalled.garden/bookmark',
      url,
      author: {
        url: author.url,
        title: author.title,
        description: author.description,
        type: author.type
      },
      crawledAt: row.crawledAt,
    },
    url,
    content: {
      href: row.href,
      title: row.title,
      description: row.description
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}