const globals = require('../../globals')
const assert = require('assert')
const tagsCrawler = require('../../crawler/tags')
const appPerms = require('../../lib/app-perms')

// typedefs
// =

/**
 * @typedef {import('../../crawler/tags').Tag} Tag
 *
 * @typedef {Object} TagPublicAPIRecord
 * @prop {string} tag
 * @prop {number} count
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string} [opts.filters.visibility]
   * @param {string} [opts.sortBy]
   * @param {number} [opts.offset=0]
   * @param {number} [opts.limit]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<TagPublicAPIRecord[]>}
   */
  async listBookmarkTags (opts) {
    await appPerms.assertCan(this.sender, 'unwalled.garden/perm/bookmarks', 'read')
    opts = (opts && typeof opts === 'object') ? opts : {}
    if (opts && 'sortBy' in opts) assert(typeof opts.sortBy === 'string', 'SortBy must be a string')
    if (opts && 'offset' in opts) assert(typeof opts.offset === 'number', 'Offset must be a number')
    if (opts && 'limit' in opts) assert(typeof opts.limit === 'number', 'Limit must be a number')
    if (opts && 'reverse' in opts) assert(typeof opts.reverse === 'boolean', 'Reverse must be a boolean')
    if (opts && opts.filters) {
      if ('authors' in opts.filters) {
        if (Array.isArray(opts.filters.authors)) {
          assert(opts.filters.authors.every(v => typeof v === 'string'), 'Authors filter must be a string or array of strings')
        } else {
          assert(typeof opts.filters.authors === 'string', 'Authors filter must be a string or array of strings')
        }
      }
      if ('visibility' in opts.filters) {
        assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
      }
    }
    var tags = await tagsCrawler.listBookmarkTags(opts)
    return tags.map(massageTagRecord)
  },

  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string} [opts.filters.visibility]
   * @param {string} [opts.sortBy]
   * @param {number} [opts.offset=0]
   * @param {number} [opts.limit]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<TagPublicAPIRecord[]>}
   */
  async listDiscussionTags (opts) {
    await appPerms.assertCan(this.sender, 'unwalled.garden/perm/discussions', 'read')
    opts = (opts && typeof opts === 'object') ? opts : {}
    if (opts && 'sortBy' in opts) assert(typeof opts.sortBy === 'string', 'SortBy must be a string')
    if (opts && 'offset' in opts) assert(typeof opts.offset === 'number', 'Offset must be a number')
    if (opts && 'limit' in opts) assert(typeof opts.limit === 'number', 'Limit must be a number')
    if (opts && 'reverse' in opts) assert(typeof opts.reverse === 'boolean', 'Reverse must be a boolean')
    if (opts && opts.filters) {
      if ('authors' in opts.filters) {
        if (Array.isArray(opts.filters.authors)) {
          assert(opts.filters.authors.every(v => typeof v === 'string'), 'Authors filter must be a string or array of strings')
        } else {
          assert(typeof opts.filters.authors === 'string', 'Authors filter must be a string or array of strings')
        }
      }
      if ('visibility' in opts.filters) {
        assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
      }
    }
    var tags = await tagsCrawler.listDiscussionTags(opts)
    return tags.map(massageTagRecord)
  },

  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string|string[]} [opts.filters.subtypes]
   * @param {string} [opts.filters.visibility]
   * @param {string} [opts.sortBy]
   * @param {number} [opts.offset=0]
   * @param {number} [opts.limit]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<TagPublicAPIRecord[]>}
   */
  async listMediaTags (opts) {
    await appPerms.assertCan(this.sender, 'unwalled.garden/perm/media', 'read')
    opts = (opts && typeof opts === 'object') ? opts : {}
    if (opts && 'sortBy' in opts) assert(typeof opts.sortBy === 'string', 'SortBy must be a string')
    if (opts && 'offset' in opts) assert(typeof opts.offset === 'number', 'Offset must be a number')
    if (opts && 'limit' in opts) assert(typeof opts.limit === 'number', 'Limit must be a number')
    if (opts && 'reverse' in opts) assert(typeof opts.reverse === 'boolean', 'Reverse must be a boolean')
    if (opts && opts.filters) {
      if ('authors' in opts.filters) {
        if (Array.isArray(opts.filters.authors)) {
          assert(opts.filters.authors.every(v => typeof v === 'string'), 'Authors filter must be a string or array of strings')
        } else {
          assert(typeof opts.filters.authors === 'string', 'Authors filter must be a string or array of strings')
        }
      }
      if ('subtypes' in opts.filters) {
        if (Array.isArray(opts.filters.subtypes)) {
          assert(opts.filters.subtypes.every(v => typeof v === 'string'), 'Subtypes filter must be a string or array of strings')
        } else {
          assert(typeof opts.filters.subtypes === 'string', 'Subtypes filter must be a string or array of strings')
        }
      }
      if ('visibility' in opts.filters) {
        assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
      }
    }
    var tags = await tagsCrawler.listMediaTags(opts)
    return tags.map(massageTagRecord)
  }
}

// internal methods
// =

/**
 * @param {Tag} tag
 * @returns {TagPublicAPIRecord}
 */
function massageTagRecord (tag) {
  if (!tag) return null
  return {
    tag: tag.tag,
    count: tag.count
  }
}