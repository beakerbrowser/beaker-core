const datDns = require('../../dat/dns')
const datArchives = require('../../dat/archives')
const archivesDb = require('../../dbs/archives')
const datLibrary = require('../../filesystem/dat-library')
const trash = require('../../filesystem/trash')
const users = require('../../filesystem/users')
const {PermissionsError} = require('beaker-error-constants')

// typedefs
// =

/**
 * @typedef {import('../../filesystem/dat-library').LibraryDat} LibraryDat
 *
 * @typedef {Object} ArchivePublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string | Array<string>} type
 * @prop {number} mtime
 * @prop {number} size
 * @prop {string} forkOf
 * @prop {boolean} isOwner
 * @prop {number} lastAccessTime
 * @prop {number} lastLibraryAccessTime
 * @prop {Object} userSettings
 * @prop {boolean} userSettings.isSaved
 * @prop {boolean} userSettings.isHosting
 * @prop {string} userSettings.visibility
 * @prop {Date} userSettings.savedAt
 */

// exported api
// =

module.exports = {

  // system state
  // =

  async status () {
    var status = {archives: 0, peers: 0}
    var archives = datArchives.getActiveArchives()
    for (var k in archives) {
      status.archives++
      status.peers += archives[k].metadata.peers.length
    }
    return status
  },

  // local cache management and querying
  // =

  async list (query = {}) {
    var dats = datLibrary.query(query)
    return Promise.all(dats.map(massageRecord))
  },

  async configure (url, opts) {
    var archive = await datArchives.getOrLoadArchive(url)
    return datLibrary.configureArchive(archive, opts)
  },

  async delete (url) {
    var archive = await datArchives.getOrLoadArchive(url)
    assertArchiveDeletable(archive.key)
    await datLibrary.configureArchive(archive, {isSaved: false})
    await datArchives.unloadArchive(archive.key)
    var bytes = await archivesDb.deleteArchive(archive.key)
    return {bytes}
  },

  // internal management
  // =

  async touch (key, timeVar, value) {
    return archivesDb.touch(key, timeVar, value)
  },

  async clearFileCache (url) {
    return datArchives.clearFileCache(await datArchives.fromURLToKey(url, true))
  },

  async clearGarbage () {
    return trash.collect()
  },

  clearDnsCache () {
    datDns.flushCache()
  },

  // events
  // =

  createEventStream () {
    return datArchives.createEventStream()
  },

  getDebugLog (key) {
    return datArchives.getDebugLog(key)
  },

  createDebugStream () {
    return datArchives.createDebugStream()
  }
}

// internal methods
// =

function assertArchiveDeletable (key) {
  if (users.isUser(`dat://${key}`)) {
    throw new PermissionsError('Unable to delete the user profile.')
  }
}

/**
 * @param {LibraryDat} record
 * @returns {Promise<ArchivePublicAPIRecord>}
 */
async function massageRecord (record) {
  return {
    url: await datArchives.getPrimaryUrl(record.meta.key),
    title: record.meta.title,
    description: record.meta.description,
    type: record.meta.type,
    mtime: record.meta.mtime,
    size: record.meta.size,
    forkOf: record.meta.forkOf,
    isOwner: record.meta.isOwner,
    lastAccessTime: record.meta.lastAccessTime,
    lastLibraryAccessTime: record.meta.lastLibraryAccessTime,
    userSettings: {
      isSaved: record.isSaved,
      isHosting: record.isHosting,
      visibility: record.visibility,
      savedAt: record.savedAt
    }
  }
}