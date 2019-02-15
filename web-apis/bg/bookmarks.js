const globals = require('../../globals')
const {PermissionsError} = require('beaker-error-constants')
const bookmarksDb = require('../../dbs/bookmarks')

// exported api
// =

module.exports = {
  async list (opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    return bookmarksDb.listBookmarks(0, opts)
  },

  async listTags () {
    await assertPermission(this.sender, 'dangerousAppControl')
    return bookmarksDb.listBookmarkTags(0)
  },

  // fetch bookmark data from the current user's data
  async get (href) {
    await assertPermission(this.sender, 'dangerousAppControl')
    return bookmarksDb.getBookmark(0, href)
  },

  // check if bookmark exists in the current user's data
  async has (href) {
    await assertPermission(this.sender, 'dangerousAppControl')
    try {
      var bookmark = await bookmarksDb.getBookmark(0, href)
      return !!bookmark
    } catch (e) {
      return false
    }
  },

  async add (data) {
    await assertPermission(this.sender, 'dangerousAppControl')
    await bookmarksDb.addBookmark(0, data)
  },

  async edit (href, data = {}) {
    await assertPermission(this.sender, 'dangerousAppControl')
    await bookmarksDb.editBookmark(0, href, data)
  },

  async remove (href) {
    await assertPermission(this.sender, 'dangerousAppControl')
    await bookmarksDb.removeBookmark(0, href)
  },

  async configure (opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    if (opts.pins) {
      if (!Array.isArray(opts.pins)) throw new Error('.pins must be an array of URLs')
      return bookmarksDb.setBookmarkPinOrder(0, opts.pins)
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
