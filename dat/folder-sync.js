const bytes = require('bytes')
const dft = require('diff-file-tree')
const diff = require('diff')
const anymatch = require('anymatch')
const fs = require('fs')
const jetpack = require('fs-jetpack')
const path = require('path')
const EventEmitter = require('events')
const datEncoding = require('dat-encoding')
const mkdirp = require('mkdirp')
const isEqual = require('lodash.isequal')
const {toAnymatchRules} = require('@beaker/datignore')
const logger = require('../logger').child({category: 'dat', subcategory: 'folder-sync'})
const {isFileNameBinary, isFileContentBinary} = require('../lib/mime')
const lock = require('../lib/lock')
const scopedFSes = require('../lib/scoped-fses')
const {
  NotFoundError,
  NotAFolderError,
  ProtectedFileNotWritableError,
  ArchiveNotWritableError,
  InvalidEncodingError,
  SourceTooLargeError
} = require('beaker-error-constants')

const MAX_DIFF_SIZE = bytes('100kb')

// typedefs
// =

/**
 * @typedef {import('./daemon').DaemonDatArchive} DaemonDatArchive
 */

// globals
// =

var datPath = ''
var disallowedSavePaths = []
var localSyncSettings = {} // key -> settings object
var syncEventQueues = {} // key -> queue object
var stopWatchingLocalFolderFns = {} // key -> function
var stopWatchingDatIgnoreFns = {} // key -> function
var compareContentCaches = {} // key -> object
var datIgnoreRules = {} // key -> object
var syncCallCounts = {} // key -> number
var activeSyncs = {} // key -> number

// exported api
// =

const events = exports.events = new EventEmitter()

exports.setup = function (opts) {
  datPath = opts.datPath
  disallowedSavePaths = opts.disallowedSavePaths
}

exports.reconfigureArchive = function (archive, userSettings) {
  var oldLocalSyncSettings = localSyncSettings[archive.key]
  localSyncSettings[archive.key] = getLocalSyncSettings(archive, userSettings)

  if (!isEqual(localSyncSettings[archive.key], oldLocalSyncSettings)) {
    // configure the local folder watcher if a change occurred
    configureFolderToArchiveWatcher(archive)
  }

  if (!localSyncSettings[archive.key] || !localSyncSettings[archive.key].isUsingInternal) {
    // clear the internal directory if it's not in use
    jetpack.removeAsync(getInternalLocalSyncPath(archive))
  }
}

/**
 * @desc Sync dat to the folder
 * @param {DaemonDatArchive} archive
 * @param {Object} [opts]
 * @param {boolean} [opts.shallow=true] dont descend into changed folders (default true)
 * @param {boolean} [opts.compareContent=true] compare the actual content (default true)
 * @param {string[]} [opts.paths] a whitelist of files to compare
 * @param {string} [opts.localSyncPath] override the archive localSyncPath
 * @param {boolean} [opts.addOnly=false] dont modify or remove any files (default false)
 * @returns {Promise<void>}
 */
const syncArchiveToFolder = exports.syncArchiveToFolder = function (archive, opts = {}) {
  opts = opts || {}
  return sync(archive, false, opts)
}

/**
 * @desc sync folder to the dat
 * @param {DaemonDatArchive} archive
 * @param {Object} [opts]
 * @param {boolean} [opts.shallow=true] dont descend into changed folders (default true)
 * @param {boolean} [opts.compareContent=true] compare the actual content (default true)
 * @param {string[]} [opts.paths] a whitelist of files to compare
 * @param {string} [opts.localSyncPath] override the archive localSyncPath
 * @param {boolean} [opts.addOnly=false] dont modify or remove any files (default false)
 * @returns {Promise<void>}
 */
const syncFolderToArchive = exports.syncFolderToArchive = function (archive, opts = {}) {
  opts = opts || {}
  if (!archive.writable) throw new ArchiveNotWritableError()
  return sync(archive, true, opts)
}

/**
 * @desc Helper to wait for sync on an archive to be finished
 * @param {DaemonDatArchive} archive
 * @returns {Promise<void>}
 */
const ensureSyncFinished = exports.ensureSyncFinished = async function (archive) {
  var isFinished
  var release = await getArchiveSyncLock(archive)
  try { isFinished = (activeSyncs[archive.key] == 0) }
  finally { release() }
  if (!isFinished) {
    return ensureSyncFinished(archive) // check again
  }
}

/**
 * @desc Queue a sync event from folder->archive or archive->folder
 * - debounces the sync event with a 500ms timeout
 * - call with toFolder: true to sync from archive->folder
 * - call with toArchive: true to sync from folder->archive
 * - if both toFolder && toArchive are queued, toArchive wins (local folder wins)
 * - this *will* result in lost changes in the archive if simultaneous changes happen in the local folder,
 *   but it creates very deterministic results
 * @param {DaemonDatArchive} archive
 * @param {Object} opts
 * @param {boolean} [opts.toFolder=false]
 * @param {boolean} [opts.toArchive=false]
 * @returns {void}
 */
const queueSyncEvent = exports.queueSyncEvent = function (archive, {toFolder, toArchive}) {
  if (!syncEventQueues[archive.key]) {
    syncEventQueues[archive.key] = newQueueObj()
  }
  var queue = syncEventQueues[archive.key]

  // ignore if currently syncing
  if (queue.isSyncing) {
    logger.silly('Already syncing, ignored')
    return
  }

  // debounce the handler
  if (queue.timeout) {
    clearTimeout(queue.timeout)
  }

  // queue
  if (toFolder) queue.toFolder = true
  if (toArchive) queue.toArchive = true
  queue.timeout = setTimeout(async () => {
    const localSyncPath = localSyncSettings[archive.key].path
    const {toArchive, toFolder} = queue

    // lock
    queue.isSyncing = true
    logger.silly('Ok timed out, beginning sync', {details: {toArchive, toFolder}})

    try {
      let st = await stat(fs, localSyncPath)
      if (!st) {
        // folder has been removed
        stopWatchingLocalFolderFns[archive.key]()
        stopWatchingLocalFolderFns[archive.key] = null
        logger.warn('Local sync folder not found, aborting watch', {details: {path: localSyncPath}})
        return
      }
      // sync with priority given to the local folder
      if (toArchive) await syncFolderToArchive(archive, {localSyncPath, shallow: false})
      else if (toFolder) await syncArchiveToFolder(archive, {localSyncPath, shallow: false})
    } catch (e) {
      logger.error('Error syncing folder', {details: {path: localSyncPath, error: e.toString()}})
      if (e.name === 'CycleError') {
        events.emit('error', archive.key, e)
      }
    } finally {
      // reset the queue
      queue = newQueueObj()
    }
  }, 500)
}
function newQueueObj () {
  return {timeout: null, toFolder: false, toArchive: false, isSyncing: false}
}

/**
 * @desc Attach/detach a watcher on the local folder and sync it to the dat.
 * @param {DaemonDatArchive} archive
 * @returns {Promise<void>}
 */
const configureFolderToArchiveWatcher = exports.configureFolderToArchiveWatcher = async function (archive) {
  // HACKish
  // it's possible that configureFolderToArchiveWatcher() could be called multiple times in sequence
  // (for instance because of multiple settings changes)
  // this is problematic because the method is async, and a previous call may still be in progress
  // shouldAbort() tracks whether such an event has occurred and lets you drop out
  // put this after every await:
  //
  // if (shouldAbort()) return
  //
  // -prf
  var callCount = syncCallCounts[archive.key] = (syncCallCounts[archive.key] || 0) + 1
  const shouldAbort = () => callCount !== syncCallCounts[archive.key]

  // teardown the existing watch (his watch has ended)
  // =

  if (stopWatchingLocalFolderFns[archive.key]) {
    // stop watching
    stopWatchingLocalFolderFns[archive.key]()
    stopWatchingLocalFolderFns[archive.key] = null
    if (syncEventQueues[archive.key] && syncEventQueues[archive.key].timeout) {
      clearTimeout(syncEventQueues[archive.key].timeout)
      syncEventQueues[archive.key] = null
    }
  }
  if (stopWatchingDatIgnoreFns[archive.key]) {
    stopWatchingDatIgnoreFns[archive.key]()
    stopWatchingDatIgnoreFns[archive.key] = null
  }

  // start a new watch
  // =

  if (localSyncSettings[archive.key]) {
    logger.silly('Configuring archive sync', {details: {key: archive.key.toString('hex'), settings: localSyncSettings[archive.key]}})

    // create diff cache
    compareContentCaches[archive.key] = {}

    // create internal folder if needed
    if (localSyncSettings[archive.key].isUsingInternal) {
      mkdirp.sync(localSyncSettings[archive.key].path)
    }

    // make sure the folder exists
    let st = await stat(fs, localSyncSettings[archive.key].path)
    if (shouldAbort()) return
    if (!st) {
      logger.warn('Local sync folder not found, aborting watch', {details: {path: localSyncSettings[archive.key].path}})
    }
    var scopedFS = scopedFSes.get(localSyncSettings[archive.key].path)

    // track datignore rules
    readDatIgnore(scopedFS).then(rules => { datIgnoreRules[archive.key] = rules })
    stopWatchingDatIgnoreFns[archive.key] = scopedFS.watch('/.datignore', async () => {
      datIgnoreRules[archive.key] = await readDatIgnore(scopedFS)
    })

    if (!localSyncSettings[archive.key].autoPublish) {
      // no need to setup watcher
      // just do an add-only sync from archive->folder
      await sync(archive, false, {shallow: false, addOnly: true})
      if (shouldAbort()) return
    } else {
      // sync up
      try {
        await mergeArchiveAndFolder(archive, localSyncSettings[archive.key].path)
      } catch (err) {
        logger.error('Failed to merge local sync folder', {details: {err}})
      }
      if (shouldAbort()) return

      // start watching
      stopWatchingLocalFolderFns[archive.key] = scopedFS.watch('/', path => {
        // TODO
        // it would be possible to make this more efficient by ignoring changes that match .datignore
        // but you need to make sure you have the latest .datignore and reading that on every change-event isnt efficient
        // so you either need to:
        //  A. queue up all the changed paths, then read the datignore inside the timeout and filter, if filteredList.length === 0 then abort
        //  B. maintain an in-memory copy of the datignore and keep it up-to-date, and then check at time of the event
        // -prf

        logger.silly('Change detected', {details: {path}})
        queueSyncEvent(archive, {toArchive: true})
      })
    }
  } else {
    // clear diff cache
    compareContentCaches[archive.key] = {}
  }
}

/**
 * @desc List the files that differ.
 * @param {DaemonDatArchive} archive
 * @param {Object} opts
 * @param {boolean} [opts.shallow=true] dont descend into changed folders (default true)
 * @param {boolean} [opts.compareContent=true] compare the actual content (default true)
 * @param {string[]} [opts.paths] a whitelist of files to compare
 * @param {string} [opts.localSyncPath] override the archive localSyncPath
 * @returns {Promise<Array>}
 */
exports.diffListing = async function (archive, opts = {}) {
  opts = opts || {}
  var localSyncPath = opts.localSyncPath || (localSyncSettings[archive.key] && localSyncSettings[archive.key].path)
  if (!localSyncPath) {
    logger.warn('Sanity check failed - diffListing() aborting, no localSyncPath')
    return []
  }
  var scopedFS = scopedFSes.get(localSyncPath)
  opts = massageDiffOpts(opts)

  // build ignore rules
  var newOpts = /** @type Object */({...opts})
  if (opts.paths) {
    newOpts.filter = makeDiffFilterByPaths(opts.paths)
  } else {
    const ignoreRules = await readDatIgnore(scopedFS)
    newOpts.filter = (filepath) => anymatch(ignoreRules, filepath)
  }

  // run diff
  newOpts.compareContentCache = compareContentCaches[archive.key]
  return dft.diff({fs: scopedFS}, {fs: archive}, newOpts)
}

/**
 * @desc Diff an individual file
 * @param {DaemonDatArchive} archive
 * @param {string} filepath the path of the file in the archive/folder
 * @returns {Promise<Array>}
 */
exports.diffFile = async function (archive, filepath) {
  if (!localSyncSettings[archive.key].path) {
    logger.warn('Sanity check failed - diffFile() aborting, no localSyncPath')
    return []
  }
  var scopedFS = scopedFSes.get(localSyncSettings[archive.key].path)
  filepath = path.normalize(filepath)

  // check the filename to see if it's binary
  var isBinary = isFileNameBinary(filepath)
  if (isBinary === true) {
    throw new InvalidEncodingError('Cannot diff a binary file')
  }

  // make sure we can handle the buffers involved
  let st
  st = await stat(scopedFS, filepath)
  if (isBinary !== false && st && st.isFile() && await isFileContentBinary(scopedFS, filepath)) {
    throw new InvalidEncodingError('Cannot diff a binary file')
  }
  if (st && st.isFile() && st.size > MAX_DIFF_SIZE) {
    throw new SourceTooLargeError()
  }
  st = await stat(archive, filepath)
  if (isBinary !== false && st && st.isFile() && await isFileContentBinary(archive, filepath)) {
    throw new InvalidEncodingError('Cannot diff a binary file')
  }
  if (st && st.isFile() && st.size > MAX_DIFF_SIZE) {
    throw new SourceTooLargeError()
  }

  // read the file in both sources
  const [newFile, oldFile] = await Promise.all([readFile(scopedFS, filepath), readFile(archive, filepath)])

  // return the diff
  return diff.diffLines(oldFile, newFile)
}

/**
 * @desc Validate a path to be used for sync.
 * @param {string} p
 */
exports.assertSafePath = async function (p) {
  // check whether this is an OS path
  for (let disallowedSavePath of disallowedSavePaths) {
    if (path.normalize(p) === path.normalize(disallowedSavePath)) {
      throw new ProtectedFileNotWritableError(`This is a protected folder. Please pick another folder or subfolder.`)
    }
  }

  // stat the folder
  const stat = await new Promise(resolve => {
    fs.stat(p, (_, st) => resolve(st))
  })

  if (!stat) {
    throw new NotFoundError()
  }

  if (!stat.isDirectory()) {
    throw new NotAFolderError('Invalid target folder: not a folder')
  }
}

/**
 * @desc Read a datignore from a fs space and turn it into anymatch rules.
 * @param {Object} fs
 * @returns {Promise<string[]>}
 */
const readDatIgnore = exports.readDatIgnore = async function (fs) {
  var rulesRaw = await readFile(fs, '.datignore')
  return toAnymatchRules(rulesRaw)
}

/**
 * @desc Filter function used by scoped-fs to hide files in the datignore.
 * @param {DaemonDatArchive} archive
 * @param {string} filepath
 * @return {boolean}
 */
exports.applyDatIgnoreFilter = function (archive, filepath) {
  const rules = datIgnoreRules[archive.key] || toAnymatchRules('')
  var filepaths = explodeFilePaths(filepath) // we need to check parent paths in addition to the target path
  var res = filepaths.filter(p => anymatch(rules, p)).length === 0
  return res
}

/**
 * @desc Merge the dat.json in the folder and then merge files, with preference to folder files.
 * @param {DaemonDatArchive} archive
 * @param {string} localSyncPath
 * @returns {Promise<void>}
 */
const mergeArchiveAndFolder = exports.mergeArchiveAndFolder = async function (archive, localSyncPath) {
  logger.silly('Merging archive and folder', {details: {path: localSyncPath, key: archive.key.toString('hex')}})
  const readManifest = async (fs) => {
    try { return await fs.pda.readManifest() } catch (e) { return {} }
  }
  var localFS = scopedFSes.get(localSyncPath)
  var localManifest = await readManifest(localFS)
  var archiveManifest = await readManifest(archive)
  var mergedManifest = Object.assign(archiveManifest || {}, localManifest || {})
  await localFS.pda.writeManifest(mergedManifest)
  await sync(archive, false, {localSyncPath, shallow: false, addOnly: true}) // archive -> folder (add-only)
  await sync(archive, true, {localSyncPath, shallow: false}) // folder -> archive
  events.emit('merge:' + archive.key.toString('hex'), archive.key)
  logger.silly('Done merging archive and folder', {details: {path: localSyncPath, key: archive.key.toString('hex')}})
}

// internal methods
// =

/**
 * @desc Sync the dat & folder content
 * @param {DaemonDatArchive} archive
 * @param {boolean} toArchive true to sync folder to archive, false to sync archive to folder
 * @param {Object} [opts]
 * @param {boolean} [opts.shallow=true] dont descend into changed folders (default true)
 * @param {boolean} [opts.compareContent=true] compare the actual content (default true)
 * @param {string[]} [opts.paths] a whitelist of files to compare
 * @param {string} [opts.localSyncPath] override the archive localSyncPath
 * @param {boolean} [opts.addOnly=false] dont modify or remove any files (default false)
 * @returns {Promise<void>}
 */
async function sync (archive, toArchive, opts = {}) {
  opts = opts || {}
  var localSyncPath = opts.localSyncPath || (localSyncSettings[archive.key] && localSyncSettings[archive.key].path)
  if (!localSyncPath) {
    logger.warn('Sanity check failed - sync() aborting, no localSyncPath')
    return
  }

  activeSyncs[archive.key] = (activeSyncs[archive.key] || 0) + 1
  var release = await getArchiveSyncLock(archive)
  try {
    var scopedFS = scopedFSes.get(localSyncPath)
    opts = massageDiffOpts(opts)
    var diffOpts = /** @type Object */({...opts})

    // build ignore rules
    if (opts.paths) {
      diffOpts.filter = makeDiffFilterByPaths(opts.paths)
    } else {
      let ignoreRules = await readDatIgnore(scopedFS)
      diffOpts.filter = (filepath) => anymatch(ignoreRules, filepath)
    }

    // choose direction
    var left = toArchive ? {fs: scopedFS} : {fs: archive}
    var right = toArchive ? {fs: archive} : {fs: scopedFS}

    // run diff
    diffOpts.compareContentCache = compareContentCaches[archive.key]
    var diff = await dft.diff(left, right, diffOpts)
    if (opts.addOnly) {
      diff = diff.filter(d => d.change === 'add')
    }
    logger.silly(`Syncing to ${toArchive ? 'archive' : 'folder'}`, {details: {key: archive.key.toString('hex'), path: localSyncPath}})

    // sync data
    await dft.applyRight(left, right, diff)
    events.emit('sync', archive.key, toArchive ? 'archive' : 'folder')
    events.emit('sync:' + archive.key.toString('hex'), archive.key, toArchive ? 'archive' : 'folder')

    // decrement active syncs
    activeSyncs[archive.key]--
  } catch (err) {
    logger.error('Failed to sync archive to local path', {details: {key: archive.key.toString('hex'), path: localSyncPath, err: err.toString()}})
  } finally {
    release()
  }
}

/**
 * @param {DaemonDatArchive} archive
 * @returns {Promise<Function>}
 */
function getArchiveSyncLock (archive) {
  return lock('sync:' + archive.key.toString('hex'))
}

/**
 * @param {string[]} targetPaths
 * @return {Function(string): boolean}
 */
function makeDiffFilterByPaths (targetPaths) {
  targetPaths = targetPaths.map(path.normalize)
  return (filepath) => {
    for (let i = 0; i < targetPaths.length; i++) {
      let targetPath = targetPaths[i]

      if (targetPath.endsWith(path.sep)) {
        // a directory
        if (filepath === targetPath.slice(0, -1)) return false // the directory itself
        if (filepath.startsWith(targetPath)) return false // a file within the directory
      } else {
        // a file
        if (filepath === targetPath) return false
      }
      if (targetPath.startsWith(filepath) && targetPath.charAt(filepath.length) === path.sep) {
        return false // a parent folder
      }
    }
    return true
  }
}

/**
 * @param {Object} opts
 * @returns {Object}
 */
function massageDiffOpts (opts) {
  return {
    compareContent: typeof opts.compareContent === 'boolean' ? opts.compareContent : true,
    shallow: typeof opts.shallow === 'boolean' ? opts.shallow : true,
    paths: Array.isArray(opts.paths) ? opts.paths.filter(v => typeof v === 'string') : false,
    addOnly: typeof opts.addOnly === 'boolean' ? opts.addOnly : false
  }
}

/**
 * @param {string|DaemonDatArchive} archiveOrKey
 * @returns {string}
 */
function getInternalLocalSyncPath (archiveOrKey) {
  var key = datEncoding.toStr(typeof archiveOrKey === 'string' ? archiveOrKey : archiveOrKey.key)
  return path.join(datPath, 'Archives', 'LocalCopy', key.slice(0, 2), key.slice(2))
}

/**
 * @param {DaemonDatArchive} archive
 * @param {Object} userSettings
 * @returns {Object}
 */
function getLocalSyncSettings (archive, userSettings) {
  if (!archive.writable || !userSettings.isSaved) {
    return false
  }
  if (userSettings.localSyncPath) {
    return {
      path: userSettings.localSyncPath,
      autoPublish: !userSettings.previewMode
    }
  }
  if (userSettings.previewMode) {
    return {
      path: getInternalLocalSyncPath(archive),
      autoPublish: false,
      isUsingInternal: true
    }
  }
  return false
}

// helper to read a file via promise and return a null on fail
async function stat (fs, filepath) {
  return new Promise(resolve => {
    fs.stat(filepath, (_, data) => {
      resolve(data || null)
    })
  })
}

// helper to read a file via promise and return an empty string on fail
async function readFile (fs, filepath) {
  return new Promise(resolve => {
    fs.readFile(filepath, {encoding: 'utf8'}, (_, data) => {
      resolve(data || '')
    })
  })
}

// helper to go from '/foo/bar/baz' to ['/', '/foo', '/foo/bar', '/foo/bar/baz']
function explodeFilePaths (str) {
  str = str.replace(/^\/|\/$/g, '') // strip leading and trailing slashes
  var paths = str.split('/')
  let lastPath = ''
  for (let i = 0; i < paths.length; i++) {
    lastPath = paths[i] = `${lastPath}/${paths[i]}`
  }
  return paths
}
