const globals = require('../../globals')
const datArchives = require('../../dat/archives')
const archivesDb = require('../../dbs/archives')
const uwg = require('../../uwg')
const sessionPerms = require('../../lib/session-perms')
const users = require('../../filesystem/users')

// typedefs
// =

/**
 * @typedef {import('../../dbs/archives').LibraryArchiveRecord} LibraryArchiveRecord
 *
 * @typedef {Object} ProfilesPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string} type
 * @prop {boolean} isOwner
 */

// exported api
// =

/**
 *
 * @param {string} url
 * @returns {Promise<ProfilesPublicAPIRecord>}
 */
async function get (url) {
  var key = await datArchives.fromURLToKey(url, true)
  var meta = await archivesDb.getMeta(key)
  return {
    url: meta.url,
    title: meta.title,
    description: meta.description,
    type: meta.type,
    isOwner: meta.isOwner
  }
}

module.exports = {
  /**
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async me () {
    await sessionPerms.getSessionOrThrow(this.sender)
    var sess = globals.userSessionAPI.getFor(this.sender)
    if (!sess) return null
    return get(sess.url)
  },

  /**
   * @param {string} url
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async get (url) {
    await sessionPerms.getSessionOrThrow(this.sender)
    return get(url)
  },

  /**
   * @param {string} url
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async index (url) {
    await sessionPerms.getSessionOrThrow(this.sender)
    await uwg.crawlSite(url)
    return get(url)
  },

  /**
   * @param {string} [url]
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async editProfileDialog (url) {
    var sess = await sessionPerms.getSessionOrThrow(this.sender)
    
    var user
    if (url) user = await users.get(url)
    else if (sess) user = await users.get(sess.url)
    else user = await users.getDefault()

    await globals.uiAPI.showModal(this.sender, 'user', user)
    return get(user.url)
  }
}

function toOrigin (url) {
  try {
    let urlp = new URL(url)
    return `${urlp.protocol}//${urlp.hostname}`
  } catch (e) {
    return url
  }
}