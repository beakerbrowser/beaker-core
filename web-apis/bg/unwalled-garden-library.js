const assert = require('assert')
const datArchives = require('../../dat/archives')
const sessionPerms = require('../../lib/session-perms')
const datLibrary = require('../../filesystem/dat-library')

// typedefs
// =

/**
 * @typedef {import('../../filesystem/dat-library').LibraryDat} LibraryDat
 *
 * @typedef {Object} LibraryPublicAPIRecord
 * @prop {string} key
 * @prop {string} url
 * @prop {Object} author
 * @prop {string} author.url
 * @prop {string} author.title
 * @prop {string} author.description
 * @prop {string} author.type
 * @prop {boolean} author.isOwner
 * @prop {Object} meta
 * @prop {string} meta.title
 * @prop {string} meta.description
 * @prop {string} meta.type
 * @prop {number} meta.mtime
 * @prop {number} meta.size
 * @prop {string} meta.author
 * @prop {string} meta.forkOf
 * @prop {boolean} meta.isOwner
 * @prop {boolean} isSaved
 * @prop {number} savedAt
 * @prop {boolean} isHosting
 * @prop {string} visibility
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.types]
   * @param {string} [opts.authors]
   * @param {string} [opts.keys]
   * @param {string} [opts.visibility]
   * @param {string} [opts.forkOf]
   * @param {boolean} [opts.isSaved]
   * @param {boolean} [opts.isHosting]
   * @param {boolean} [opts.isOwner]
   * @param {string} [opts.sortBy]
   * @param {number} [opts.offset=0]
   * @param {number} [opts.limit]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<LibraryPublicAPIRecord[]>}
   */
  async list (opts) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/library', 'read')
    opts = (opts && typeof opts === 'object') ? opts : {}
    if (typeof opts.sortBy !== 'undefined') assert(typeof opts.sortBy === 'string', 'SortBy must be a string')
    if (typeof opts.offset !== 'undefined') assert(typeof opts.offset === 'number', 'Offset must be a number')
    if (typeof opts.limit !== 'undefined') assert(typeof opts.limit === 'number', 'Limit must be a number')
    if (typeof opts.reverse !== 'undefined') assert(typeof opts.reverse === 'boolean', 'Reverse must be a boolean')
    if (typeof opts.visibility !== 'undefined') assert(typeof opts.visibility === 'string', 'Visibility filter must be a string')
    if (typeof opts.forkOf !== 'undefined') assert(typeof opts.forkOf === 'string', 'ForkOf filter must be a string')
    if (typeof opts.isSaved !== 'undefined') assert(typeof opts.isSaved === 'boolean', 'isSaved filter must be a boolean')
    if (typeof opts.isHosting !== 'undefined') assert(typeof opts.isHosting === 'boolean', 'isHosting filter must be a boolean')
    if (typeof opts.isOwner !== 'undefined') assert(typeof opts.isOwner === 'boolean', 'isOwner filter must be a boolean')
    if (typeof opts.types !== 'undefined') {
      if (Array.isArray(opts.types)) {
        assert(opts.types.every(v => typeof v === 'string'), 'Types filter must be a string or array of strings')
      } else {
        assert(typeof opts.types === 'string', 'Types filter must be a string or array of strings')
      }
    }
    if (typeof opts.authors !== 'undefined') {
      if (Array.isArray(opts.authors)) {
        assert(opts.authors.every(v => typeof v === 'string'), 'Authors filter must be a string or array of strings')
      } else {
        assert(typeof opts.authors === 'string', 'Authors filter must be a string or array of strings')
      }
    }
    if (typeof opts.keys !== 'undefined') {
      if (Array.isArray(opts.keys)) {
        assert(opts.keys.every(v => typeof v === 'string'), 'Keys filter must be a string or array of strings')
      } else {
        assert(typeof opts.keys === 'string', 'Keys filter must be a string or array of strings')
      }
    }
    var records = await datLibrary.list(opts)
    return records.map(massageRecord)
  },

  /**
   * @param {string} key
   * @param {Object} [settings]
   * @param {boolean} [settings.isSaved]
   * @param {boolean} [settings.isHosting]
   * @param {string} [settings.visibility]
   * @returns {Promise<void>}
   */
  async configure (key, settings) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/library', 'write')
    var archive = await datArchives.getOrLoadArchive(key)
    return datLibrary.configureArchive(archive, settings)
  }
}

// internal methods
// =

/**
 * @param {LibraryDat} record
 * @returns {LibraryPublicAPIRecord}
 */
function massageRecord (record) {
  return {
    key: record.key,
    url: `dat://${record.key}`,
    author: record.author ? {
      url: record.author.url,
      title: record.author.title,
      description: record.author.description,
      type: record.author.type,
      isOwner: record.author.isOwner
    } : undefined,
    meta: {
      title: record.meta.title,
      description: record.meta.description,
      type: record.meta.type,
      mtime: record.meta.mtime,
      size: record.meta.size,
      author: record.meta.author,
      forkOf: record.meta.forkOf,
      isOwner: record.meta.isOwner
    },
    isSaved: record.isSaved,
    isHosting: record.isHosting,
    visibility: record.visibility,
    savedAt: Number(record.savedAt)
  }
}