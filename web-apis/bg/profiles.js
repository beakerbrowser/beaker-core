const globals = require('../../globals')
const datLibrary = require('../../dat/library')
const {PermissionsError} = require('beaker-error-constants')

// typedefs
// =

/**
 * @typedef {import('../../dbs/archives').LibraryArchiveRecord} LibraryArchiveRecord
 * 
 * @typedef {Object} ProfilesPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 */

// exported api
// =

async function get (url) {
  var key = datLibrary.fromURLToKey(url)
  var archive = /** @type LibraryArchiveRecord */(await datLibrary.queryArchives({key}))
  if (!archive) return null
  return {
    url,
    title: archive.title,
    description: archive.description,
    type: archive.type
  }
}

module.exports = {
  /**
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async getCurrentUser () {
    await assertPermission(this.sender, 'dangerousAppControl')
    var sess = globals.userSessionAPI.getFor(this.sender)
    if (!sess) return null
    return get(sess.url)
  },

  /**
   * @param {string} url
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async get (url) {
    await assertPermission(this.sender, 'dangerousAppControl')
    return get(url)
  }
}

async function assertPermission (sender, perm) {
  if (sender.getURL().startsWith('beaker:')) {
    return true
  }
  if (await globals.permsAPI.requestPermission(perm, sender)) return true
  throw new PermissionsError()
}
