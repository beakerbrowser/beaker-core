const globals = require('../../globals')
const {PermissionsError} = require('beaker-error-constants')
const bookmarksDb = require('../../dbs/bookmarks')
const bookmarksCrawler = require('../../crawler/bookmarks')
const siteDescriptions = require('../../crawler/site-descriptions')
const {toOrigin} = require('../../crawler/util')
const _get = require('lodash.get')

// typedefs
// =

/**
 * @typedef {Object} BookmarkAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 *
 * @typedef {Object} BookmarkPublicAPIRecord
 * @prop {BookmarkAuthorPublicAPIRecord} author
 * @prop {Object} record
 * @prop {string} record.url
 * @prop {number} createdAt
 * @prop {string} href
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} tags
 * @prop {boolean} pinned
 * @prop {boolean} isPublic
 * @prop {boolean} isOwner
 * @prop {number} pinOrder
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string|string[]} [opts.filters.tag]
   * @param {boolean} [opts.filters.pinned]
   * @param {boolean} [opts.filters.isPublic]
   * @param {string} [opts.sortBy] - 'title' or 'createdAt' (default 'title')
   * @param {number} [opts.offset] - default 0
   * @param {number} [opts.limit]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<BookmarkPublicAPIRecord[]>}
   */
  async query (opts) {
    await assertPermission(this.sender, 'dangerousAppControl')

    // NOTE
    // The crawled and local-user bookmarks are stored in separate tables
    // For now, those tables are queried separately, combined, and then filtered/sorted/sliced
    // That won't scale - we really need to leverage sqlite's on-disk indexing to perform well
    // We should plan to rewrite that way
    // -prf

    // fetch user
    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var user = await siteDescriptions.getBest({subject: userSession.url, author: userSession.url})

    // massage params
    var tagFilter = _get(opts, 'filters.tag', undefined)
    var pinnedFilter = _get(opts, 'filters.pinned', undefined)
    var publicFilter = _get(opts, 'filters.isPublic', undefined)
    var authorsFilter = _get(opts, 'filters.authors', undefined)
    if (authorsFilter) {
      if (!Array.isArray(authorsFilter)) authorsFilter = [authorsFilter]
      authorsFilter = authorsFilter.map(toOrigin).filter(Boolean)
    }

    // if the pinned filter is truthy, only fetch from the local database
    // (the bookmarksCrawler cant filter on 'pinned' and we only need local results anyway)
    if (pinnedFilter) publicFilter = false

    // construct results
    var bookmarks = []
    if (publicFilter === undefined || publicFilter === false) {
      // only fetch local results if there is no authors filter or if the authors filter includes the user
      if (!authorsFilter || authorsFilter.includes(userSession.url)) {
        let internalBoookmarks = await bookmarksDb.listBookmarks(0, opts)
        bookmarks = bookmarks.concat(internalBoookmarks.map(b => normalizeInternalBookmark(b, user)))
      }
    }
    if (publicFilter === undefined || publicFilter === true) {
      let uwFilters = {}
      if (authorsFilter) uwFilters.authors = authorsFilter
      let uwBookmarks = await bookmarksCrawler.query({filters: uwFilters})
      if (publicFilter === undefined) {
        // filter out the user's bookmarks, because they'll be duplicates
        uwBookmarks = uwBookmarks.filter(b => b.author.url !== user.url)
      }
      let pinneds = await bookmarksDb.listBookmarks(0, {filters: {pinned: true}})
      bookmarks = bookmarks.concat(uwBookmarks.map(b => normalizeUWBookmark(b, user, pinneds)))
    }

    // apply tag filter
    if (tagFilter) {
      if (Array.isArray(tagFilter)) {
        bookmarks = bookmarks.filter(b => {
          return /** @type string[] */(tagFilter).reduce((agg, t) => agg && b.tags.includes(t), true)
        })
      } else {
        bookmarks = bookmarks.filter(b => b.tags.includes(tagFilter))
      }
    }

    // apply sorting
    var dir = _get(opts, 'reverse') ? -1 : 1
    var sortBy = _get(opts, 'sortBy', 'title')
    if (sortBy === 'createdAt') {
      bookmarks.sort((a, b) => (b.createdAt - a.createdAt) * dir)
    } else {
      bookmarks.sort((a, b) => (a.title || '').localeCompare(b.title || '') * dir)
    }

    // apply offset & limit
    var offset = _get(opts, 'offset')
    var limit = _get(opts, 'limit')
    if (typeof limit !== 'undefined') {
      offset = offset || 0
      bookmarks = bookmarks.slice(offset, offset + limit)
    } else if (typeof offset !== 'undefined') {
      bookmarks = bookmarks.slice(offset)
    }

    return bookmarks
  },

  /**
   * @returns {Promise<string[]>}
   */
  async listTags () {
    await assertPermission(this.sender, 'dangerousAppControl')
    return bookmarksDb.listBookmarkTags(0)
  },

  /**
   * @param {string} href
   * @returns {Promise<BookmarkPublicAPIRecord>}
   */
  async get (href) {
    await assertPermission(this.sender, 'dangerousAppControl')

    // fetch user
    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var user = await siteDescriptions.getBest({subject: userSession.url, author: userSession.url})

    // fetch bookmark
    return normalizeInternalBookmark(await bookmarksDb.getBookmark(0, href), user)
  },

  /**
   * @param {string} href
   * @returns {Promise<boolean>}
   */
  async has (href) {
    await assertPermission(this.sender, 'dangerousAppControl')
    try {
      var bookmark = await bookmarksDb.getBookmark(0, href)
      return !!bookmark
    } catch (e) {
      return false
    }
  },

  /**
   * @param {Object} data
   * @param {string} [data.href]
   * @param {string} [data.title]
   * @param {string} [data.description]
   * @param {string | string[]} [data.tags]
   * @param {boolean} [data.pinned]
   * @param {boolean} [data.isPublic]
   * @returns {Promise<void>}
   */
  async add (data) {
    await assertPermission(this.sender, 'dangerousAppControl')
    await bookmarksDb.addBookmark(0, data)
  },

  /**
   * @param {string} href
   * @param {Object} data
   * @param {string} [data.href]
   * @param {string} [data.title]
   * @param {string} [data.description]
   * @param {string | string[]} [data.tags]
   * @param {boolean} [data.pinned]
   * @param {boolean} [data.isPublic]
   * @returns {Promise<void>}
   */
  async edit (href, data = {}) {
    await assertPermission(this.sender, 'dangerousAppControl')
    await bookmarksDb.editBookmark(0, href, data)
  },

  /**
   * @param {string} href
   * @returns {Promise<void>}
   */
  async remove (href) {
    await assertPermission(this.sender, 'dangerousAppControl')
    await bookmarksDb.removeBookmark(0, href)
  },

  /**
   * @param {Object} opts
   * @param {string[]} [opts.pins]
   * @returns {Promise<void>}
   */
  async configure (opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    if (opts.pins) {
      if (!Array.isArray(opts.pins)) throw new Error('.pins must be an array of URLs')
      await bookmarksDb.setBookmarkPinOrder(0, opts.pins)
    }
  }
}

async function assertPermission (sender, perm) {
  if (sender.getURL().startsWith('beaker:')) {
    return true
  }
  if (await globals.permsAPI.requestPermission(perm, sender)) return true
  throw new PermissionsError()
}

function normalizeInternalBookmark (bookmark, user) {
  if (!bookmark) return null
  bookmark.record = null
  bookmark.author = user
  bookmark.isOwner = true
  return bookmark
}

/**
 *
 * @param {*} bookmark
 * @param {*} user
 * @param {*} pinneds
 * @returns {BookmarkPublicAPIRecord}
 */
function normalizeUWBookmark (bookmark, user, pinneds) {
  return {
    record: {url: bookmark.author.url + bookmark.pathname},
    author: bookmark.author,
    href: bookmark.href,
    title: bookmark.title,
    description: bookmark.description,
    tags: bookmark.tags,
    createdAt: bookmark.createdAt,
    isOwner: bookmark.isOwner,
    pinned: bookmark.isOwner && pinneds.find(p => p.href === bookmark.href),
    pinOrder: 0,
    isPublic: true
  }
}
