const path = require('path')
const mkdirp = require('mkdirp')
const jetpack = require('fs-jetpack')
const datDns = require('../../dat/dns')
const datLibrary = require('../../dat/library')
const datGC = require('../../dat/garbage-collector')
const archivesDb = require('../../dbs/archives')
const archiveDraftsDb = require('../../dbs/archive-drafts')
const {cbPromise} = require('../../lib/functions')
const {timer} = require('../../lib/time')
const users = require('../../users')
const {PermissionsError} = require('beaker-error-constants')

// exported api
// =

module.exports = {

  // system state
  // =

  async status () {
    var status = {archives: 0, peers: 0}
    var archives = datLibrary.getActiveArchives()
    for (var k in archives) {
      status.archives++
      status.peers += archives[k].metadata.peers.length
    }
    return status
  },

  // local cache management and querying
  // =

  async setUserSettings (url, opts) {
    var key = await datLibrary.fromURLToKey(url, true)
    return archivesDb.setUserSettings(0, key, opts)
  },

  async add (url, opts = {}) {
    var key = await datLibrary.fromURLToKey(url, true)

    // pull metadata
    var archive = await datLibrary.getOrLoadArchive(key)
    await datLibrary.pullLatestArchiveMeta(archive)

    // update settings
    opts.isSaved = true
    return archivesDb.setUserSettings(0, key, opts)
  },

  async remove (url) {
    var key = await datLibrary.fromURLToKey(url, true)
    assertArchiveDeletable(key)
    return archivesDb.setUserSettings(0, key, {isSaved: false})
  },

  async bulkRemove (urls) {
    var results = []

    // sanity check
    if (!urls || !Array.isArray(urls)) {
      return []
    }

    for (var i = 0; i < urls.length; i++) {
      let key = await datLibrary.fromURLToKey(urls[i], true)
      assertArchiveDeletable(key)
      results.push(await archivesDb.setUserSettings(0, key, {isSaved: false}))
    }
    return results
  },

  async delete (url) {
    const key = await datLibrary.fromURLToKey(url, true)
    assertArchiveDeletable(key)
    const drafts = await archiveDraftsDb.list(0, key)
    const toDelete = [{key}].concat(drafts)
    var bytes = 0
    for (let archive of toDelete) {
      await archivesDb.setUserSettings(0, archive.key, {isSaved: false})
      await datLibrary.unloadArchive(archive.key)
      bytes += await archivesDb.deleteArchive(archive.key)
    }
    return {bytes}
  },

  async list (query = {}) {
    return datLibrary.queryArchives(query)
  },

  // folder sync
  // =

  async validateLocalSyncPath (key, localSyncPath) {
    key = await datLibrary.fromURLToKey(key, true)
    localSyncPath = path.normalize(localSyncPath)

    // make sure the path is good
    try {
      await datLibrary.getDaemon().fs_assertSafePath(localSyncPath)
    } catch (e) {
      if (e.notFound) {
        return {doesNotExist: true}
      }
      throw e
    }

    // check for conflicts
    var archive = await datLibrary.getOrLoadArchive(key)
    var diff = await datLibrary.getDaemon().fs_diffListing(archive, {localSyncPath})
    diff = diff.filter(d => d.change === 'mod' && d.path !== '/dat.json')
    if (diff.length) {
      return {hasConflicts: true, conflicts: diff.map(d => d.path)}
    }

    return {}
  },

  async setLocalSyncPath (key, localSyncPath, opts = {}) {
    key = await datLibrary.fromURLToKey(key, true)
    localSyncPath = localSyncPath ? path.normalize(localSyncPath) : null

    // disable path
    if (!localSyncPath) {
      let oldSettings = await archivesDb.getUserSettings(0, key)
      await archivesDb.setUserSettings(0, key, {localSyncPath: ''})

      if (opts.deleteSyncPath && oldSettings.localSyncPath) {
        try {
          await datLibrary.getDaemon().fs_assertSafePath(oldSettings.localSyncPath)
          await jetpack.removeAsync(oldSettings.localSyncPath)
        } catch (_) {}
      }
      return
    }

    // load the archive
    await timer(3e3, async (checkin) => { // put a max 3s timeout on loading the dat
      checkin('searching for dat')
      await datLibrary.getOrLoadArchive(key)
    })

    // make sure the path is good
    try {
      await datLibrary.getDaemon().fs_assertSafePath(localSyncPath)
    } catch (e) {
      if (e.notFound) {
        // just create the folder
        await cbPromise(cb => mkdirp(localSyncPath, cb))
      } else {
        throw e
      }
    }

    // update the record
    var newValues = {localSyncPath}
    if ('previewMode' in opts) {
      newValues.previewMode = opts.previewMode
    }
    await archivesDb.setUserSettings(0, key, newValues)
  },

  async ensureLocalSyncFinished (key) {
    key = await datLibrary.fromURLToKey(key, true)

    // load the archive
    var archive
    await timer(3e3, async (checkin) => { // put a max 3s timeout on loading the dat
      checkin('searching for dat')
      archive = await datLibrary.getOrLoadArchive(key)
    })

    // ensure sync
    await datLibrary.getDaemon().fs_ensureSyncFinished(archive)
  },

  // diff & publish
  // =

  async diffLocalSyncPathListing (key, opts) {
    key = await datLibrary.fromURLToKey(key, true)

    // load the archive
    var archive
    await timer(3e3, async (checkin) => { // put a max 3s timeout on loading the dat
      checkin('searching for dat')
      archive = await datLibrary.getOrLoadArchive(key)
    })

    return datLibrary.getDaemon().fs_diffListing(archive, opts)
  },

  async diffLocalSyncPathFile (key, filepath) {
    key = await datLibrary.fromURLToKey(key, true)

    // load the archive
    var archive
    await timer(3e3, async (checkin) => { // put a max 3s timeout on loading the dat
      checkin('searching for dat')
      archive = await datLibrary.getOrLoadArchive(key)
    })

    return datLibrary.getDaemon().fs_diffFile(archive, filepath)
  },

  async publishLocalSyncPathListing (key, opts = {}) {
    key = await datLibrary.fromURLToKey(key, true)

    // load the archive
    var archive
    await timer(3e3, async (checkin) => { // put a max 3s timeout on loading the dat
      checkin('searching for dat')
      archive = await datLibrary.getOrLoadArchive(key)
    })

    opts.shallow = false
    return datLibrary.getDaemon().fs_syncFolderToArchive(archive, opts)
  },

  async revertLocalSyncPathListing (key, opts = {}) {
    key = await datLibrary.fromURLToKey(key, true)

    // load the archive
    var archive
    await timer(3e3, async (checkin) => { // put a max 3s timeout on loading the dat
      checkin('searching for dat')
      archive = await datLibrary.getOrLoadArchive(key)
    })

    opts.shallow = false
    return datLibrary.getDaemon().fs_syncArchiveToFolder(archive, opts)
  },

  // drafts
  // =

  async getDraftInfo (url) {
    var key = await datLibrary.fromURLToKey(url, true)
    var masterKey = await archiveDraftsDb.getMaster(0, key)
    var master = await archivesDb.query(0, {key: masterKey})
    var drafts = await archiveDraftsDb.list(0, masterKey)
    return {master, drafts}
  },

  async listDrafts (masterUrl) {
    var masterKey = await datLibrary.fromURLToKey(masterUrl, true)
    return archiveDraftsDb.list(0, masterKey)
  },

  async addDraft (masterUrl, draftUrl) {
    var masterKey = await datLibrary.fromURLToKey(masterUrl, true)
    var draftKey = await datLibrary.fromURLToKey(draftUrl, true)

    // make sure we're modifying the master
    masterKey = await archiveDraftsDb.getMaster(0, masterKey)

    return archiveDraftsDb.add(0, masterKey, draftKey)
  },

  async removeDraft (masterUrl, draftUrl) {
    var masterKey = await datLibrary.fromURLToKey(masterUrl, true)
    var draftKey = await datLibrary.fromURLToKey(draftUrl, true)

    // make sure we're modifying the master
    masterKey = await archiveDraftsDb.getMaster(0, masterKey)

    return archiveDraftsDb.remove(0, masterKey, draftKey)
  },

  // internal management
  // =

  async touch (key, timeVar, value) {
    return archivesDb.touch(key, timeVar, value)
  },

  async clearFileCache (url) {
    return datLibrary.clearFileCache(await datLibrary.fromURLToKey(url, true))
  },

  async clearGarbage ({isOwner} = {}) {
    return datGC.collect({olderThan: 0, biggerThan: 0, isOwner})
  },

  clearDnsCache () {
    datDns.flushCache()
  },

  // events
  // =

  createEventStream () {
    return datLibrary.createEventStream()
  },

  getDebugLog (key) {
    return datLibrary.getDebugLog(key)
  },

  createDebugStream () {
    return datLibrary.createDebugStream()
  }
}

// internal methods
// =

function assertArchiveDeletable (key) {
  if (users.isUser(`dat://${key}`)) {
    throw new PermissionsError('Unable to delete the user profile.')
  }
}