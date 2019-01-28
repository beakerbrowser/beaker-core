const _groupBy = require('lodash.groupby')
const _uniqWith = require('lodash.uniqwith')
const db = require('../dbs/profile-data-db')
const bookmarksDb = require('../dbs/bookmarks')
const historyDb = require('../dbs/history')
const datLibrary = require('../dat/library')
const followgraph = require('./followgraph')
const siteDescriptions = require('./site-descriptions')
const {getBasicType} = require('../lib/dat')
const {getSiteDescriptionThumbnailUrl} = require('./util')

/** @type {Array<Object>} */
const BUILTIN_PAGES = [
  // {title: 'Timeline', url: 'beaker://timeline'}, DISABLED -prf
  {title: 'Your Library', url: 'beaker://library'},
  {title: 'Search', url: 'beaker://search'},
  {title: 'Bookmarks', url: 'beaker://bookmarks'},
  {title: 'History', url: 'beaker://history'},
  {title: 'Watchlist', url: 'beaker://watchlist'},
  {title: 'Downloads', url: 'beaker://downloads'},
  {title: 'Settings', url: 'beaker://settings'},
]

// typedefs
// =

/**
 * @typedef {import("./site-descriptions").SiteDescription} SiteDescription
 * @typedef {import("../dbs/archives").LibraryArchiveRecord} LibraryArchiveRecord
 *
 * @typedef {Object} SuggestionResults
 * @prop {Array<Object>} apps
 * @prop {Array<Object>} people
 * @prop {Array<Object>} webPages
 * @prop {Array<Object>} fileShares
 * @prop {Array<Object>} imageCollections
 * @prop {Array<Object>} others
 * @prop {(undefined|Array<Object>)} bookmarks
 * @prop {(undefined|Array<Object>)} history
 *
 * TODO: define the SuggestionResults values
 *
 * @typedef {Object} SearchResults
 * @prop {number} highlightNonce - A number used to create perimeters around text that should be highlighted.
 * @prop {Array<UserSearchResult|SiteSearchResult|PostSearchResult>} results
 *
 * @typedef {Object} UserSearchResult
 * @prop {string} resultType
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<SiteDescription>} followedBy
 * @prop {bool} followsUser
 * @prop {string} thumbUrl
 * @prop {Object} author
 * @prop {string} author.url
 *
 * @typedef {Object} PostSearchResult
 * @prop {string} resultType
 * @prop {string} url
 * @prop {SiteDescription} author
 * @prop {Object} content
 * @prop {string} content.url
 * @prop {string} content.title
 * @prop {string} content.description
 * @prop {Array<string>} content.type
 * @prop {number} crawledAt
 * @prop {number} createdAt
 * @prop {number} updatedAt
 *
 * @typedef {Object} SiteSearchResult
 * @prop {string} resultType
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<string>} type
 * @prop {string} thumbUrl
 * @prop {Object} descAuthor
 * @prop {string} descAuthor.url
 * @prop {SiteDescription} author
 */

// exported api
// =

/**
 * @description
 * Get suggested content of various types.
 *
 * @param {string} [query=''] - The search query.
 * @param {Object} [opts={}]
 * @param {boolean} [opts.filterPins] - If true, will filter out pinned bookmarks.
 * @returns {Promise<SuggestionResults>}
 */
exports.listSuggestions = async function (query = '', opts = {}) {
  var suggestions = {}
  const filterFn = a => ((a.url || a.href).includes(query) || a.title.toLowerCase().includes(query))

  // builtin pages
  suggestions.apps = BUILTIN_PAGES.filter(filterFn)

  // library
  var libraryResults = /** @type LibraryArchiveRecord[] */(await datLibrary.queryArchives({isSaved: true}))
  libraryResults = libraryResults.filter(filterFn)
  var libraryResultsGrouped = _groupBy(libraryResults, a => getBasicType(a.type))
  suggestions.people = libraryResultsGrouped.user
  suggestions.webPages = libraryResultsGrouped['web-page']
  suggestions.fileShares = libraryResultsGrouped['file-share']
  suggestions.imageCollections = libraryResultsGrouped['image-collection']
  suggestions.others = libraryResultsGrouped.other

  if (query) {
    // bookmarks
    var bookmarkResults = await bookmarksDb.listBookmarks(0)
    if (opts.filterPins) {
      bookmarkResults = bookmarkResults.filter(b => !b.pinned && filterFn(b))
    } else {
      bookmarkResults = bookmarkResults.filter(filterFn)
    }
    bookmarkResults = bookmarkResults.slice(0, 12)
    suggestions.bookmarks = bookmarkResults.map(b => ({title: b.title, url: b.href}))

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
 * @param {Object} opts
 * @param {string} opts.user - The current user's URL.
 * @param {string} [opts.query] - The search query.
 * @param {number} [opts.hops=1] - How many hops out in the user's follow graph should be included?
 * @param {string} [opts.type] - Content type to query. Defaults to all except users.
 * @param {number} [opts.since] - Filter results to items created since the given timestamp.
 * @param {number} [opts.offset]
 * @param {number} [opts.limit = 20]
 * @returns {Promise<SearchResults>}
 */
exports.listSearchResults = async function (opts) {
  const highlightNonce =  (Math.random() * 1e3)|0
  const startHighlight = `{${highlightNonce}}`
  const endHighlight = `{/${highlightNonce}}`

  var searchResults = {
    highlightNonce,
    results: []
  }
  var {user, query, hops, type, since, offset, limit} = opts
  type = type || 'all'
  since = since || 0
  offset = offset || 0
  limit = limit || 20
  hops = Math.min(Math.max(Math.floor(hops), 1), 2) // clamp to [1, 2] for now

  // prep search terms
  if (query && typeof query === 'string') {
    query = query
      .toLowerCase() // all lowercase. (uppercase is interpretted as a directive by sqlite.)
      .replace(/[:^*.]/g, ' ') // strip symbols that sqlite interprets.
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
        INNER JOIN crawl_followgraph fgraph ON fgraph.destUrl = src.url AND fgraph.crawlSourceId = ?
    `, [userCrawlSourceId])
    crawlSourceIds = [userCrawlSourceId].concat(res.map(({id}) => id))
  } else if (hops === 1) {
    // just the user
    crawlSourceIds = [userCrawlSourceId]
  }

  // run queries
  if (type === 'all' || type === 'user') {
    // FOLLOWS
    let rows
    if (query) {
      rows = await db.all(`
        SELECT
            desc.url AS url,
            descSrc.url AS authorUrl,
            SNIPPET(crawl_site_descriptions_fts_index, 0, '${startHighlight}', '${endHighlight}', '...', 25) AS title,
            SNIPPET(crawl_site_descriptions_fts_index, 1, '${startHighlight}', '${endHighlight}', '...', 25) AS description,
            desc.crawledAt
          FROM crawl_site_descriptions_fts_index desc_fts
          INNER JOIN crawl_site_descriptions desc ON desc.rowid = desc_fts.rowid
          LEFT JOIN crawl_followgraph fgraph ON fgraph.destUrl = desc.url
          INNER JOIN crawl_sources descSrc ON desc.crawlSourceId = descSrc.id
          WHERE
            crawl_site_descriptions_fts_index MATCH ?
            AND (
              fgraph.crawlSourceId IN (${crawlSourceIds.join(',')}) -- description by a followed user
              OR (desc.url = ? AND desc.crawlSourceId = ?) -- description by me about me
            )
            AND desc.crawledAt >= ?
          ORDER BY desc.crawledAt
          LIMIT ?
          OFFSET ?;
      `, [query, user, userCrawlSourceId, since, limit, offset])
    } else {
      rows = await db.all(`
        SELECT desc.url AS url, desc.title, desc.description, descSrc.url AS authorUrl, desc.crawledAt
          FROM crawl_site_descriptions desc
          LEFT JOIN crawl_followgraph fgraph ON fgraph.destUrl = desc.url
          INNER JOIN crawl_sources descSrc ON desc.crawlSourceId = descSrc.id
          WHERE 
            (
              fgraph.crawlSourceId IN (${crawlSourceIds.join(',')}) -- description by a followed user
              OR (desc.url = ? AND desc.crawlSourceId = ?) -- description by me about me
            )
            AND desc.crawledAt >= ?
          ORDER BY desc.crawledAt
          LIMIT ?
          OFFSET ?;
      `, [user, userCrawlSourceId, since, limit, offset])
    }
    rows = _uniqWith(rows, (a, b) => a.url === b.url) // remove duplicates
    await Promise.all(rows.map(async (p) => {
      // fetch additional info
      p.followedBy = await followgraph.listFollowers(p.url, {includeDesc: true})
      p.followsUser = await followgraph.isAFollowingB(p.url, user)

      // massage attrs
      p.resultType = 'user'
      p.thumbUrl = getSiteDescriptionThumbnailUrl(p.authorUrl, p.url)
      p.author = {url: p.authorUrl}
      delete p.authorUrl
    }))
    searchResults.results = searchResults.results.concat(rows)
  }
  if (type !== 'user') {
    // POSTS
    let rows
    if (query) {
      rows = await db.all(`
        SELECT
            post.url,
            SNIPPET(crawl_link_posts_fts_index, 0, '${startHighlight}', '${endHighlight}', '...', 25) AS title,
            SNIPPET(crawl_link_posts_fts_index, 1, '${startHighlight}', '${endHighlight}', '...', 25) AS description,
            post.type,
            post.pathname,
            post.crawledAt,
            post.createdAt,
            post.updatedAt,
            postSrc.url AS authorUrl
          FROM crawl_link_posts_fts_index post_fts
          INNER JOIN crawl_link_posts post ON post.rowid = post_fts.rowid
          INNER JOIN crawl_sources postSrc ON post.crawlSourceId = postSrc.id
          LEFT JOIN crawl_followgraph fgraph ON fgraph.destUrl = postSrc.url 
          WHERE
            crawl_link_posts_fts_index MATCH ?
            AND (fgraph.crawlSourceId IN (${crawlSourceIds.join(',')}) OR post.crawlSourceId = ?)
            AND post.crawledAt >= ?
          ORDER BY post.crawledAt
          LIMIT ?
          OFFSET ?;
      `, [query, userCrawlSourceId, since, limit, offset])
    } else {
      rows = await db.all(`
        SELECT
            post.url,
            post.title,
            post.description,
            post.type,
            post.pathname,
            post.crawledAt,
            post.createdAt,
            post.updatedAt,
            postSrc.url AS authorUrl
          FROM crawl_link_posts post
          INNER JOIN crawl_sources postSrc ON post.crawlSourceId = postSrc.id
          LEFT JOIN crawl_followgraph fgraph ON fgraph.destUrl = postSrc.url 
          WHERE
            (fgraph.crawlSourceId IN (${crawlSourceIds.join(',')}) OR post.crawlSourceId = ?)
            AND post.crawledAt >= ?
          ORDER BY post.crawledAt DESC
          LIMIT ?
          OFFSET ?;
      `, [userCrawlSourceId, since, limit, offset])
    }
    searchResults.results = searchResults.results.concat(await Promise.all(rows.map(async (p) => {
      // fetch additional info
      var author = await siteDescriptions.getBest({subject: p.authorUrl})

      // massage attrs
      return {
        resultType: 'post',
        url: p.authorUrl + p.pathname,
        author,
        content: {
          url: p.url,
          title: p.title,
          description: p.description,
          type: p.type.split(',')
        },
        crawledAt: p.crawledAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }
    })))
  }
  if (type !== 'user') {
    // SITES
    let rows
    if (query) {
      rows = await db.all(`
        SELECT
            pub.url AS url,
            pubSrc.url AS authorUrl,
            SNIPPET(crawl_site_descriptions_fts_index, 0, '${startHighlight}', '${endHighlight}', '...', 25) AS title,
            SNIPPET(crawl_site_descriptions_fts_index, 1, '${startHighlight}', '${endHighlight}', '...', 25) AS description,
            desc.crawledAt
          FROM crawl_site_descriptions_fts_index desc_fts
          INNER JOIN crawl_site_descriptions desc ON desc.rowid = desc_fts.rowid
          INNER JOIN crawl_published_sites pub ON pub.url = desc.url
          INNER JOIN crawl_sources pubSrc ON pub.crawlSourceId = pubSrc.id
          LEFT JOIN crawl_followgraph fgraph ON fgraph.destUrl = pubSrc.url
          WHERE
            crawl_site_descriptions_fts_index MATCH ?
            ${''/* TODO AND (',' || desc.type || ',') LIKE ?*/}
            AND (fgraph.crawlSourceId IN (${crawlSourceIds.join(',')}) OR pubSrc.id = ?) -- site published by a me or a followed user
            AND desc.crawledAt >= ?
          ORDER BY desc.crawledAt
          LIMIT ?
          OFFSET ?;
      `, [query, /*TODO `%,${type},%`,*/ userCrawlSourceId, since, limit, offset])
    } else {
      rows = await db.all(`
        SELECT pub.url AS url, pubSrc.url AS authorUrl, desc.crawledAt
          FROM crawl_published_sites pub
          INNER JOIN crawl_site_descriptions desc ON desc.url = pub.url
          INNER JOIN crawl_sources pubSrc ON pub.crawlSourceId = pubSrc.id
          LEFT JOIN crawl_followgraph fgraph ON fgraph.destUrl = pubSrc.url
          WHERE 
            ${''/* TODO (',' || desc.type || ',') LIKE ?
            AND*/} (fgraph.crawlSourceId IN (${crawlSourceIds.join(',')}) OR pubSrc.id = ?) -- site published by a me or a followed user
            AND desc.crawledAt >= ?
          ORDER BY pub.crawledAt
          LIMIT ?
          OFFSET ?;
      `, [/* TODO `%,${type},%`,*/ userCrawlSourceId, since, limit, offset])
    }
    rows = _uniqWith(rows, (a, b) => a.url === b.url) // remove duplicates
    searchResults.results = searchResults.results.concat(await Promise.all(rows.map(async (row) => {
      // fetch full records
      var result = /**@type SiteSearchResult*/(await siteDescriptions.getBest({subject: row.url, author: row.authorUrl}))
      result.resultType = 'site'
      result.author = await siteDescriptions.getBest({subject: row.authorUrl})

      // overwrite title and description so that highlighting can be included
      if (row.title) result.title = row.title
      if (row.description) result.description = row.description
      return result
    })))
  }

  // sort and apply limit again
  searchResults.results.sort((a, b) => b.crawledAt - a.crawledAt)
  searchResults.results = searchResults.results.slice(0, limit)

  return searchResults
}
