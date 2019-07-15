const globals = require('../../globals')
const datLibrary = require('../../dat/library')
const crawler = require('../../crawler')
const appPerms = require('../../lib/app-perms')

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
    url: toOrigin(archive.url),
    title: archive.title,
    description: archive.description,
    type: archive.type
  }
}

module.exports = {
  /**
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async me () {
    await appPerms.assertInstalled(this.sender)
    var sess = globals.userSessionAPI.getFor(this.sender)
    if (!sess) return null
    return get(sess.url)
  },

  /**
   * @param {string} url
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async get (url) {
    await appPerms.assertInstalled(this.sender)
    return get(url)
  },

  /**
   * @param {string} url
   * @returns {Promise<ProfilesPublicAPIRecord>}
   */
  async index (url) {
    await appPerms.assertInstalled(this.sender)
    await crawler.crawlSite(url)
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