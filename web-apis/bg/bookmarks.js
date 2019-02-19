const globals = require('../../globals')
const {PermissionsError} = require('beaker-error-constants')
const bookmarksDb = require('../../dbs/bookmarks')

// typedefs
// =

/**
 * @typedef {Object} BookmarkPublicAPIRecord
 * @prop {number} createdAt
 * @prop {string} href
 * @prop {string} title
 * @prop {string[]} tags
 * @prop {boolean} pinned
 * @prop {number} pinOrder
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.tag]
   * @param {boolean} [opts.filters.pinned]
   * @returns {Promise<BookmarkPublicAPIRecord[]>}
   */
  async list (opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    return bookmarksDb.listBookmarks(0, opts)
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
    return bookmarksDb.getBookmark(0, href)
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
   * @param {string | string[]} [data.tags]
   * @param {boolean} [data.pinned]
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
   * @param {string | string[]} [data.tags]
   * @param {boolean} [data.pinned]
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
