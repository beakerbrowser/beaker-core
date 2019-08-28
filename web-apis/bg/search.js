const globals = require('../../globals')
const {PermissionsError} = require('beaker-error-constants')
const search = require('../../uwg/search')

// typedefs
// =

/**
 * @typedef {Object} SearchPublicAPIResult
 * @prop {number} highlightNonce - A number used to create perimeters around text that should be highlighted.
 * @prop {Array<SearchPublicAPISiteResult|SearchPublicAPIPostResult>} results
 *
 * @typedef {Object} SearchPublicAPIResultAuthor
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<string>} type
 *
 * @typedef {Object} SearchPublicAPIResultRecord
 * @prop {string} type
 * @prop {string} url
 * @prop {number} crawledAt
 * @prop {SearchPublicAPIResultAuthor} author
 *
 * @typedef {Object} SearchPublicAPISiteResult
 * @prop {SearchPublicAPIResultRecord} record
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<string>} type
 *
 * @typedef {Object} SearchPublicAPIPostResult
 * @prop {SearchPublicAPIResultRecord} record
 * @prop {string} url
 * @prop {Object} content
 * @prop {string} content.body
 * @prop {number} createdAt
 * @prop {number} updatedAt
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} opts
   * @param {string} [opts.query] - The search query.
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.datasets] - Filter results to the given datasets. Defaults to 'all'. Valid values: 'all', 'sites', 'unwalled.garden/post'.
   * @param {number} [opts.filters.since] - Filter results to items created since the given timestamp.
   * @param {number} [opts.hops=1] - How many hops out in the user's follow graph should be included? Valid values: 1, 2.
   * @param {number} [opts.offset]
   * @param {number} [opts.limit = 20]
   * @returns {Promise<SearchPublicAPIResult>}
   */
  async query (opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var sess = globals.userSessionAPI.getFor(this.sender)
    if (!sess) return null
    return search.query(sess.url, opts)
  }
}

async function assertPermission (sender, perm) {
  if (sender.getURL().startsWith('beaker:')) {
    return true
  }
  if (await globals.permsAPI.requestPermission(perm, sender)) return true
  throw new PermissionsError()
}
