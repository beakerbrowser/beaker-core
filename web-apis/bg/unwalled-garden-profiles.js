const globals = require('../../globals')
const datArchives = require('../../dat/archives')
const archivesDb = require('../../dbs/archives')
const uwg = require('../../uwg')
const sessionPerms = require('../../lib/session-perms')

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

/**
 * 
 * @param {string} url 
 * @returns {Promise<ProfilesPublicAPIRecord>}
 */
async function get (url) {
  var key = await datArchives.fromURLToKey(url, true)
  var meta = await archivesDb.getMeta(key)
  if (!meta) return null
  return {
    url: await datArchives.getPrimaryUrl(key),
    title: meta.title,
    description: meta.description,
    type: /** @type string[] */(meta.type)
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