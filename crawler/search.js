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
  {title: 'Timeline', url: 'beaker://timeline'},
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
 * @prop {(null|Array<PeopleSearchResult>)} people
 * @prop {(null|Array<PostSearchResult>)} posts
 *
 * @typedef {Object} PeopleSearchResult
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
 * @prop {string} url
 * @prop {SiteDescription} author
 * @prop {string} content
 * @prop {number} createdAt
 * @prop {number} updatedAt
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
 * @param {Object} [opts.types] - Content types to query. Defaults to all.
 * @param {boolean} [opts.types.people]
 * @param {boolean} [opts.types.posts]
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
    people: null,
    posts: null
  }
  var {user, query, hops, types, since, offset, limit} = opts
  if (!types || typeof types !== 'object') {
    types = {people: true, posts: true}
  }
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
  if (types.people) {
    if (query) {
      searchResults.people = await db.all(`
        SELECT
            desc.url AS url,
            descSrc.url AS authorUrl,
            SNIPPET(crawl_site_descriptions_fts_index, 0, '${startHighlight}', '${endHighlight}', '...', 25) AS title,
            SNIPPET(crawl_site_descriptions_fts_index, 1, '${startHighlight}', '${endHighlight}', '...', 25) AS description
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
          ORDER BY rank
          LIMIT ?
          OFFSET ?;
      `, [query, user, userCrawlSourceId, limit, offset])
    } else {
      searchResults.people = await db.all(`
        SELECT desc.url AS url, desc.title, desc.description, descSrc.url AS authorUrl
          FROM crawl_site_descriptions desc
          LEFT JOIN crawl_followgraph fgraph ON fgraph.destUrl = desc.url
          INNER JOIN crawl_sources descSrc ON desc.crawlSourceId = descSrc.id
          WHERE (
            fgraph.crawlSourceId IN (${crawlSourceIds.join(',')}) -- description by a followed user
            OR (desc.url = ? AND desc.crawlSourceId = ?) -- description by me about me
          )
          ORDER BY desc.title
          LIMIT ?
          OFFSET ?;
      `, [user, userCrawlSourceId, limit, offset])
    }
    searchResults.people = _uniqWith(searchResults.people, (a, b) => a.url === b.url)
    await Promise.all(searchResults.people.map(async (p) => {
      // fetch additional info
      p.followedBy = await followgraph.listFollowers(p.url, {includeDesc: true})
      p.followsUser = await followgraph.isAFollowingB(p.url, user)

      // massage attrs
      p.thumbUrl = getSiteDescriptionThumbnailUrl(p.authorUrl, p.url)
      p.author = {url: p.authorUrl}
      delete p.authorUrl
    }))
  }
  if (types.posts) {
    if (query) {
      searchResults.posts = await db.all(`
        SELECT
            SNIPPET(crawl_posts_fts_index, 0, '${startHighlight}', '${endHighlight}', '...', 25) AS content,
            post.pathname,
            post.createdAt,
            post.updatedAt,
            postSrc.url AS authorUrl
          FROM crawl_posts_fts_index post_fts
          INNER JOIN crawl_posts post ON post.rowid = post_fts.rowid
          INNER JOIN crawl_sources postSrc ON post.crawlSourceId = postSrc.id
          LEFT JOIN crawl_followgraph fgraph ON fgraph.destUrl = postSrc.url 
          WHERE
            crawl_posts_fts_index MATCH ?
            AND (fgraph.crawlSourceId IN (${crawlSourceIds.join(',')}) OR post.crawlSourceId = ?)
            AND post.createdAt >= ?
          ORDER BY rank
          LIMIT ?
          OFFSET ?;
      `, [query, userCrawlSourceId, since, limit, offset])
    } else {
      searchResults.posts = await db.all(`
        SELECT post.content, post.pathname, post.createdAt, post.updatedAt, postSrc.url AS authorUrl
          FROM crawl_posts post
          INNER JOIN crawl_sources postSrc ON post.crawlSourceId = postSrc.id
          LEFT JOIN crawl_followgraph fgraph ON fgraph.destUrl = postSrc.url 
          WHERE
            (fgraph.crawlSourceId IN (${crawlSourceIds.join(',')}) OR post.crawlSourceId = ?)
            AND post.createdAt >= ?
          ORDER BY post.createdAt DESC
          LIMIT ?
          OFFSET ?;
      `, [userCrawlSourceId, since, limit, offset])
    }
    await Promise.all(searchResults.posts.map(async (p) => {
      // fetch additional info
      p.author = await siteDescriptions.getBest({subject: p.authorUrl})

      // massage attrs
      p.url = p.authorUrl + p.pathname
      delete p.authorUrl
      delete p.pathname
    }))
  }

  return searchResults
}
