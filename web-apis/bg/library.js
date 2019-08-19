const globals = require('../../globals')
const through2 = require('through2')
const datLibrary = require('../../dat/library')
const archivesDb = require('../../dbs/archives')
const users = require('../../users')
const {PermissionsError} = require('beaker-error-constants')

// typedefs
// =

/**
 * @typedef {import('../../dbs/archives').LibraryArchiveRecord} LibraryArchiveRecord
 *
 * @typedef {Object} LibraryPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<string>} type
 * @prop {number} mtime
 * @prop {number} size
 * @prop {number} connections
 * @prop {boolean} owner
 * @prop {boolean} saved
 * @prop {boolean} previewEnabled
 * @prop {string} localPath
 *
 * @typedef {Object} LibraryPublicAPIAddedEventDetail
 * @prop {string} url
 *
 * @typedef {Object} LibraryPublicAPIRemovedEventDetail
 * @prop {string} url
 *
 * @typedef {Object} LibraryPublicAPIUpdatedEventDetail
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<string>} type
 * @prop {number} mtime
 *
 * @typedef {Object} LibraryPublicAPINetworkChangedEventDetail
 * @prop {string} url
 * @prop {number} connections
 */

// exported api
// =

function add (isRequest) {
  return async function (url, opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var key = await datLibrary.fromURLToKey(url, true)
    if (opts && 'localPath' in opts) await validateLocalPath(key, opts.localPath)
    if (opts && 'previewEnabled' in opts) validatePreview(opts.previewEnabled)

    if (isRequest) {
      await checkIsntOwner(key)
      // TODO make request
    }

    // swarm the archive
    /* dont await */ datLibrary.getOrLoadArchive(key)

    // update settings
    var settings = {isSaved: true}
    if (opts && 'localPath' in opts) settings.localSyncPath = opts.localPath
    if (opts && 'previewEnabled' in opts) settings.previewMode = opts.previewEnabled
    await archivesDb.setUserSettings(0, key, settings)
  }
}

function remove (isRequest) {
  return async function (url) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var key = await datLibrary.fromURLToKey(url, true)
    assertArchiveDeletable(key)

    if (isRequest) {
      await checkIsntOwner(key)
      // TODO make request
    }

    await archivesDb.setUserSettings(0, key, {isSaved: false})
  }
}

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.type]
   * @param {boolean} [opts.filters.owner]
   * @param {boolean} [opts.filters.saved]
   * @returns {Promise<LibraryPublicAPIRecord[]>}
   */
  async list (opts = {}) {
    await assertPermission(this.sender, 'dangerousAppControl')

    var query = {}
    if (opts.filters && typeof opts.filters === 'object') {
      if ('type' in opts.filters) {
        validateTypeFilter(opts.filters.type)
        query.type = opts.filters.type
      }
      if ('owner' in opts.filters) {
        validateOwnerFilter(opts.filters.owner)
        query.isOwner = opts.filters.owner
      }
      if ('saved' in opts.filters) {
        validateSavedFilter(opts.filters.saved)
        query.isSaved = opts.filters.saved
      }
    }

    var archives = /** @type LibraryArchiveRecord[] */(await datLibrary.queryArchives(query))

    return archives.map(massageArchiveRecord)
  },

  /**
   * @param {string} url
   * @returns {Promise<LibraryPublicAPIRecord>}
   */
  async get (url) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var key = await datLibrary.fromURLToKey(url, true)
    var archive = /** @type LibraryArchiveRecord */(await datLibrary.queryArchives({key}))
    if (archive) {
      return massageArchiveRecord(archive)
    }
  },

  /**
   * @param {string} url
   * @param {Object} [opts]
   * @param {string} [opts.localPath]
   * @param {boolean} [opts.previewEnabled]
   * @returns {Promise<void>}
   */
  add: add(false),

  /**
   * @param {string} url
   * @param {Object} [opts]
   * @param {string} [opts.localPath]
   * @param {boolean} [opts.previewEnabled]
   * @returns {Promise<void>}
   */
  requestAdd: add(true),

  /**
   * @param {string} url
   * @param {Object} [opts]
   * @param {string} [opts.localPath]
   * @param {boolean} [opts.previewEnabled]
   * @returns {Promise<void>}
   */
  async edit (url, opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var key = await datLibrary.fromURLToKey(url, true)
    if (opts && 'localPath' in opts) await validateLocalPath(key, opts.localPath)
    if (opts && 'previewEnabled' in opts) validatePreview(opts.previewEnabled)

    // update settings
    var settings = {}
    if (opts && 'localPath' in opts) settings.localSyncPath = opts.localPath
    if (opts && 'previewEnabled' in opts) settings.previewMode = opts.previewEnabled
    await archivesDb.setUserSettings(0, key, settings)
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  remove: remove(false),

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  requestRemove: remove(true),

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async uncache (url) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var key = await datLibrary.fromURLToKey(url, true)
    assertArchiveDeletable(key)
    await datLibrary.clearFileCache(key)
  },

  async createEventStream () {
    await assertPermission(this.sender, 'dangerousAppControl')
    return datLibrary.createEventStream().pipe(through2.obj(function (event, enc, cb) {
      switch (event[0]) {
        case 'added':
          event[1] = /** @type LibraryPublicAPIAddedEventDetail */({url: event[1].details.url})
          this.push(event)
          break
        case 'removed':
          event[1] = /** @type LibraryPublicAPIRemovedEventDetail */({url: event[1].details.url})
          this.push(event)
          break
        case 'updated':
          event[1] = /** @type LibraryPublicAPIUpdatedEventDetail */({
            url: event[1].details.url,
            title: event[1].details.title,
            description: event[1].details.description,
            type: event[1].details.type,
            mtime: event[1].details.mtime
          })
          this.push(event)
          break
        case 'network-changed':
          event[1] = /** @type LibraryPublicAPINetworkChangedEventDetail */({
            url: event[1].details.url,
            connections: event[1].details.connections
          })
          this.push(event)
          break
      }
      cb()
    }))
  }
}

// internal methods
// =

function assertArchiveDeletable (key) {
  if (users.isUser(`dat://${key}`)) {
    throw new PermissionsError('Unable to delete the user profile.')
  }
}

async function checkIsntOwner (key) {
  var meta = await archivesDb.getMeta(key)
  if (meta.isOwner) throw new PermissionsError('Archive is owned by user')
}

async function assertPermission (sender, perm) {
  if (sender.getURL().startsWith('beaker:')) {
    return true
  }
  if (await globals.permsAPI.requestPermission(perm, sender)) return true
  throw new PermissionsError()
}

function validateTypeFilter (v) {
  if (typeof v === 'string') return
  if (Array.isArray(v) && v.every(item => typeof item === 'string')) return
  throw new Error('The `type` filter must be a string or array of strings')
}

function validateOwnerFilter (v) {
  if (typeof v === 'boolean') return
  throw new Error('The `owner` filter must be a boolean')
}

function validateSavedFilter (v) {
  if (typeof v === 'boolean') return
  throw new Error('The `saved` filter must be a boolean')
}

function validatePreview (v) {
  if (typeof v === 'boolean') return
  throw new Error('The `previewEnabled` option must be a boolean')
}

async function validateLocalPath (key, v) {
  if (typeof v !== 'string') {
    throw new Error('The `localPath` option must be a string')
  }

  // make sure the folder is usable
  try {
    await datLibrary.getDaemon().fs_assertSafePath(v)
  } catch (e) {
    if (e.notFound) {
      var e2 = new Error('The target local folder can not be found')
      e2.doesNotExist = true
      throw e2
    }
    throw e
  }

  // make sure there are no conflicts with existing files
  var archive = await datLibrary.getOrLoadArchive(key)
  var diff = await datLibrary.getDaemon().fs_diffListing(archive, {localSyncPath: v})
  diff = diff.filter(d => d.change === 'mod' && d.path !== '/dat.json')
  if (diff.length) {
    var e = new Error('There are conflicting files in the target local folder')
    e.hasConflicts = true
    e.conflicts = diff.map(d => d.path)
    throw e
  }
}

/**
 * @param {LibraryArchiveRecord} a
 * @returns {LibraryPublicAPIRecord}
 */
function massageArchiveRecord (a) {
  return {
    url: a.url,
    title: a.title,
    description: a.description,
    type: a.type,
    mtime: a.mtime,
    size: a.size,
    connections: a.peers, // .peers is attached by library.js
    owner: a.isOwner,
    saved: a.userSettings.isSaved,
    previewEnabled: a.userSettings.previewMode,
    localPath: a.userSettings.localSyncPath
  }
}
