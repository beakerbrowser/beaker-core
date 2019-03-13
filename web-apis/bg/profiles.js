const globals = require('../../globals')
const datLibrary = require('../../dat/library')
const crawler = require('../../crawler')
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
  var key = await datLibrary.fromURLToKey(url, true)
  var archive = /** @type LibraryArchiveRecord */(await datLibrary.queryArchives({key}))
  if (!archive) return null
  return {
    url: toOrigin(url),
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
  },

  /**
   * @param {string} url
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async index (url) {
    await assertPermission(this.sender, 'dangerousAppControl')
    await crawler.crawlSite(url)
    return get(url)
  },

  /**
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async openProfileEditor () {
    await assertPermission(this.sender, 'dangerousAppControl')
    var sess = globals.userSessionAPI.getFor(this.sender)
    if (!sess) return null
    var user = await get(sess.url)
    await globals.userSessionAPI.openProfileEditor(this.sender, user)
    return get(sess.url)
  }
}

async function assertPermission (sender, perm) {
  if (sender.getURL().startsWith('beaker:')) {
    return true
  }
  if (await globals.permsAPI.requestPermission(perm, sender)) return true
  throw new PermissionsError()
}

function toOrigin (url) {
  try {
    let urlp = new URL(url)
    return `${urlp.protocol}//${urlp.hostname}`
  } catch (e) {
    return url
  }
}