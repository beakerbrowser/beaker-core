const globals = require('../../globals')
const assert = require('assert')
const normalizeUrl = require('normalize-url')
const {PermissionsError} = require('beaker-error-constants')
const bookmarksDb = require('../../dbs/bookmarks')

const NORMALIZE_OPTS = {
  stripFragment: false,
  stripWWW: false,
  removeQueryParameters: false,
  removeTrailingSlash: false
}

// exported api
// =

module.exports = {

  // current user
  // =

  // fetch bookmark data from the current user's data
  async getBookmark (href) {
    await assertPermission(this.sender, 'app:bookmarks:read')
    assertString(href, 'Parameter one must be a URL')
    href = normalizeUrl(href, NORMALIZE_OPTS)
    return bookmarksDb.getBookmark(0, href)
  },

  // check if bookmark exists in the current user's data
  async isBookmarked (href) {
    await assertPermission(this.sender, 'app:bookmarks:read')
    assertString(href, 'Parameter one must be a URL')
    href = normalizeUrl(href, NORMALIZE_OPTS)
    try {
      var bookmark = await bookmarksDb.getBookmark(0, href)
      return !!bookmark
    } catch (e) {
      return false
    }
  },

  // pins
  // =

  // pin a bookmark
  async setBookmarkPinned (href, pinned) {
    await assertPermission(this.sender, 'app:bookmarks:edit-private')
    assertString(href, 'Parameter one must be a URL')
    href = normalizeUrl(href, NORMALIZE_OPTS)
    await bookmarksDb.setBookmarkPinned(0, href, pinned)
  },

  // set the order of pinned bookmarks
  async setBookmarkPinOrder (urls) {
    await assertPermission(this.sender, 'app:bookmarks:edit-private')
    if (!Array.isArray(urls)) throw new Error('Parameter one must be an array of URLs')
    return bookmarksDb.setBookmarkPinOrder(0, urls)
  },

  // list pinned bookmarks
  async listPinnedBookmarks () {
    await assertPermission(this.sender, 'app:bookmarks:read')
    return bookmarksDb.listPinnedBookmarks(0)
  },

  // bookmarks
  // =

  // bookmark
  // - data.title: string
  async bookmarkPrivate (href, data = {}) {
    await assertPermission(this.sender, 'app:bookmarks:edit-private')
    assertString(href, 'Parameter one must be a URL')
    href = normalizeUrl(href, NORMALIZE_OPTS)
    await bookmarksDb.bookmark(0, href, data)
  },

  // delete bookmark
  async unbookmarkPrivate (href) {
    await assertPermission(this.sender, 'app:bookmarks:edit-private')
    assertString(href, 'Parameter one must be a URL')
    href = normalizeUrl(href, NORMALIZE_OPTS)
    await bookmarksDb.unbookmark(0, href)
  },

  // list bookmarks
  async listPrivateBookmarks (opts) {
    await assertPermission(this.sender, 'app:bookmarks:read')
    return bookmarksDb.listBookmarks(0, opts)
  },

  // tags
  // =

  async listBookmarkTags () {
    await assertPermission(this.sender, 'app:bookmarks:read')
    return bookmarksDb.listBookmarkTags(0)
  }
}

async function assertPermission (sender, perm) {
  if (sender.getURL().startsWith('beaker:')) {
    return true
  }
  if (await globals.permsAPI.queryPermission(perm, sender)) return true
  throw new PermissionsError()
}

function assertString (v, msg) {
  assert(!!v && typeof v === 'string', msg)
}
