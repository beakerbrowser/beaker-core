const globals = require('../globals')
const bytes = require('bytes')
const dft = require('diff-file-tree')
const diff = require('diff')
const anymatch = require('anymatch')
const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')
const pda = require('pauls-dat-api')
const mkdirp = require('mkdirp')
const settingsDb = require('../dbs/settings')
const {isFileNameBinary, isFileContentBinary} = require('../lib/mime')
const scopedFSes = require('../lib/scoped-fses')
const {
  NotFoundError,
  NotAFolderError,
  ProtectedFileNotWritableError,
  ArchiveNotWritableError,
  InvalidEncodingError,
  SourceTooLargeError
} = require('beaker-error-constants')

const MAX_DIFF_SIZE = bytes('1mb')

// exported api
// =

const events = exports.events = new EventEmitter()

// sync dat to the folder
// - opts
//   - shallow: bool, dont descend into changed folders (default true)
//   - compareContent: bool, compare the actual content (default true)
//   - paths: Array<string>, a whitelist of files to compare
//   - localSyncPath: string, override the archive localSyncPath
//   - addOnly: bool, dont modify or remove any files (default false)
exports.syncArchiveToFolder = function (archive, opts = {}) {
  // dont run if a folder->archive sync is happening due to a detected change
  if (archive.syncFolderToArchiveTimeout) return console.log('Not running, locked')

  // run sync
  return sync(archive, false, opts)
}

// sync dat to the folder with a debounce of 1s
// - opts
//   - shallow: bool, dont descend into changed folders (default true)
//   - compareContent: bool, compare the actual content (default true)
//   - paths: Array<string>, a whitelist of files to compare
//   - localSyncPath: string, override the archive localSyncPath
//   - addOnly: bool, dont modify or remove any files (default false)
exports.syncArchiveToFolderDebounced = function (archive, opts = {}) {
  // debounce the handler
  if (archive.syncArchiveToFolderTimeout) {
    clearTimeout(archive.syncArchiveToFolderTimeout)
  }
  var localSyncPath = archive.localSyncSettings ? archive.localSyncSettings.path : false // capture this variable in case it changes on us
  archive.syncArchiveToFolderTimeout = setTimeout(async () => {
    // dont run if a folder->archive sync is happening due to a detected change
    if (archive.syncFolderToArchiveTimeout) return console.log('Not running, locked')

    // run sync
    opts.localSyncPath = opts.localSyncPath || localSyncPath
    await sync(archive, false, opts)
    archive.syncArchiveToFolderTimeout = null
  }, 1e3)
}

// sync folder to the dat
// - opts
//   - shallow: bool, dont descend into changed folders (default true)
//   - compareContent: bool, compare the actual content (default true)
//   - paths: Array<string>, a whitelist of files to compare
//   - localSyncPath: string, override the archive localSyncPath
//   - addOnly: bool, dont modify or remove any files (default false)
const syncFolderToArchive = exports.syncFolderToArchive = function (archive, opts = {}) {
  if (!archive.writable) throw new ArchiveNotWritableError()
  return sync(archive, true, opts)
}

// helper to wait for sync on an archive to be finished
const ensureSyncFinished = exports.ensureSyncFinished = async function (archive) {
  if (archive.syncFolderToArchiveTimeout || archive.syncArchiveToFolderTimeout) {
    console.log('ensureSyncFinished() waiting to finish sync', !!archive.syncFolderToArchiveTimeout, !!archive.syncArchiveToFolderTimeout)
    await new Promise((resolve) => {
      // wait for 'sync' to be emitted for this key
      events.once('sync:' + archive.key.toString('hex'), () => {
        // wait for next tick to allow some internal management updates
        // (not great code - we basically need the timeout to be cleared, and that happens after the event is emitted)
        process.nextTick(resolve)
      })
    })
    return ensureSyncFinished(archive) // check again
  }
}

// attach/detach a watcher on the local folder and sync it to the dat
exports.configureFolderToArchiveWatcher = async function (archive) {
  console.log('configureFolderToArchiveWatcher()', archive.localSyncSettings, !!archive.stopWatchingLocalFolder)

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
  var callCount = archive.folderSyncConfig_CallCount = (archive.folderSyncConfig_CallCount || 0) + 1
  const shouldAbort = () => callCount !== archive.folderSyncConfig_CallCount

  // teardown the existing watch (his watch has ended)
  // =

  if (archive.stopWatchingLocalFolder) {
    // stop watching
    archive.stopWatchingLocalFolder()
    archive.stopWatchingLocalFolder = null
    if (archive.syncFolderToArchiveTimeout) {
      clearTimeout(archive.syncFolderToArchiveTimeout)
      archive.syncFolderToArchiveTimeout = null
    }
  }

  // start a new watch
  // =

  if (archive.localSyncSettings) {
    // create internal folder if needed
    if (archive.localSyncSettings.isUsingInternal) {
      mkdirp.sync(archive.localSyncSettings.path)
    }

    if (!archive.localSyncSettings.autoPublish) {
      // no need to setup watcher
      // just do an add-only sync from archive->folder
      await sync(archive, false, {shallow: false, addOnly: true})
      if (shouldAbort()) return
    } else {
      // make sure the folder exists
      let st = await stat(fs, archive.localSyncSettings.path)
      if (shouldAbort()) return
      if (!st) {
        console.error('Local sync folder not found, aborting watch', archive.localSyncSettings.path)
      }

      // sync up
      try {
        await mergeArchiveAndFolder(archive, archive.localSyncSettings.path)
      } catch (e) {
        console.error('Failed to merge local sync folder', e)
      }
      if (shouldAbort()) return

      // start watching
      var isSyncing = false
      var localSyncPath = archive.localSyncSettings.path // capture this variable in case it changes on us
      var scopedFS = scopedFSes.get(localSyncPath)
      archive.stopWatchingLocalFolder = scopedFS.watch('/', path => {
        // TODO
        // it would be possible to make this more efficient by ignoring changes that match .datignore
        // but you need to make sure you have the latest .datignore and reading that on every change-event isnt efficient
        // so you either need to:
        //  A. queue up all the changed paths, then read the datignore inside the timeout and filter, if filteredList.length === 0 then abort
        //  B. maintain an in-memory copy of the datignore and keep it up-to-date, and then check at time of the event
        // -prf

        console.log('changed detected', path)
        // ignore if currently syncing
        if (isSyncing) return console.log('already syncing, ignored')
        // debounce the handler
        if (archive.syncFolderToArchiveTimeout) {
          clearTimeout(archive.syncFolderToArchiveTimeout)
        }
        archive.syncFolderToArchiveTimeout = setTimeout(async () => {
          console.log('ok timed out')
          isSyncing = true
          try {
            // await runBuild(archive)
            let st = await stat(fs, localSyncPath)
            if (!st) {
              // folder has been removed
              archive.stopWatchingLocalFolder()
              archive.stopWatchingLocalFolder = null
              console.error('Local sync folder not found, aborting watch', localSyncPath)
              return
            }
            await syncFolderToArchive(archive, {localSyncPath, shallow: false})
          } catch (e) {
            console.error('Error syncing folder', localSyncPath, e)
            if (e.name === 'CycleError') {
              events.emit('error', archive.key, e)
            }
          } finally {
            isSyncing = false
            archive.syncFolderToArchiveTimeout = null
          }
        }, 500)
      })
    }
  }
}

// list the files that differ
// - opts
//   - shallow: bool, dont descend into changed folders (default true)
//   - compareContent: bool, compare the actual content (default true)
//   - paths: Array<string>, a whitelist of files to compare
//   - localSyncPath: string, override the archive localSyncPath
exports.diffListing = async function (archive, opts = {}) {
  var localSyncPath = opts.localSyncPath || (archive.localSyncSettings && archive.localSyncSettings.path)
  if (!localSyncPath) return console.log(new Error('diffListing() aborting, no localSyncPath')) // sanity check
  var scopedFS = scopedFSes.get(localSyncPath)
  opts = massageDiffOpts(opts)

  // build ignore rules
  if (opts.paths) {
    opts.filter = makeDiffFilterByPaths(opts.paths)
  } else {
    const ignoreRules = await readDatIgnore(scopedFS)
    opts.filter = (filepath) => anymatch(ignoreRules, filepath)
  }

  // run diff
  return dft.diff({fs: scopedFS}, {fs: archive}, opts)
}

// diff an individual file
// - filepath: string, the path of the file in the archive/folder
exports.diffFile = async function (archive, filepath) {
  if (!archive.localSyncSettings.path) return console.log(new Error('diffFile() aborting, no localSyncPath')) // sanity check
  var scopedFS = scopedFSes.get(archive.localSyncSettings.path)
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

// validate a path to be used for sync
exports.assertSafePath = async function (p) {
  // check whether this is an OS path
  for (let disallowedSavePath of globals.disallowedSavePaths) {
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

// read a datignore from a fs space and turn it into anymatch rules
const readDatIgnore = exports.readDatIgnore = async function (fs) {
  var rulesRaw = await readFile(fs, '.datignore')
  if (!rulesRaw) {
    // TODO remove this? we're supposed to only use .datignore but many archives wont have one at first -prf
    rulesRaw = await settingsDb.get('default_dat_ignore')
  }
  return rulesRaw.split('\n')
    .filter(Boolean)
    .map(rule => {
      if (!rule.startsWith('/')) {
        rule = '**/' + rule
      }
      rule = rule.replace(/\r/g, '') // strip windows \r newlines
      return rule
    })
    .concat(['/.git', '/.dat'])
    .map(path.normalize)
}

// merge the dat.json in the folder and then merge files, with preference to folder files
const mergeArchiveAndFolder = exports.mergeArchiveAndFolder = async function (archive, localSyncPath) {
  console.log('merging archive with', localSyncPath)
  const readManifest = async (fs) => {
    try { return await pda.readManifest(fs) } catch (e) { return {} }
  }
  var localFS = scopedFSes.get(localSyncPath)
  var localManifest = await readManifest(localFS)
  var archiveManifest = await readManifest(archive)
  var mergedManifest = Object.assign(archiveManifest || {}, localManifest || {})
  await pda.writeManifest(localFS, mergedManifest)
  await sync(archive, false, {localSyncPath, shallow: false, addOnly: true}) // archive -> folder (add-only)
  await sync(archive, true, {localSyncPath, shallow: false}) // folder -> archive
  events.emit('merge:' + archive.key.toString('hex'), archive.key)
  console.log('done merging archive with', localSyncPath)
}

// internal methods
// =

// sync the dat & folder content
// - toArchive: true to sync folder to archive, false to sync archive to folder
// - opts
//   - shallow: bool, dont descend into changed folders (default true)
//   - compareContent: bool, compare the actual content (default true)
//   - paths: Array<string>, a whitelist of files to compare
//   - localSyncPath: string, override the archive localSyncPath
//   - addOnly: bool, dont modify or remove any files (default false)
async function sync (archive, toArchive, opts = {}) {
  var localSyncPath = opts.localSyncPath || (archive.localSyncSettings && archive.localSyncSettings.path)
  if (!localSyncPath) return console.log(new Error('sync() aborting, no localSyncPath')) // sanity check

  try {
    var scopedFS = scopedFSes.get(localSyncPath)
    opts = massageDiffOpts(opts)

    // build ignore rules
    if (opts.paths) {
      opts.filter = makeDiffFilterByPaths(opts.paths)
    } else {
      let ignoreRules = await readDatIgnore(scopedFS)
      opts.filter = (filepath) => anymatch(ignoreRules, filepath)
    }

    // choose direction
    var left = toArchive ? {fs: scopedFS} : {fs: archive}
    var right = toArchive ? {fs: archive} : {fs: scopedFS}

    // run diff
    var diff = await dft.diff(left, right, opts)
    if (opts.addOnly) {
      diff = diff.filter(d => d.change === 'add')
    }
    console.log('syncing to', toArchive ? 'archive' : 'folder', diff) // DEBUG

    // sync data
    await dft.applyRight(left, right, diff)
    events.emit('sync', archive.key, toArchive ? 'archive' : 'folder')
    events.emit('sync:' + archive.key.toString('hex'), archive.key, toArchive ? 'archive' : 'folder')
  } catch (err) {
    console.error('Failed to sync archive to local path')
    console.error('- Archive:', archive.key.toString('hex'))
    console.error('- Path:', localSyncPath)
    console.error('- Error:', err)
  }
}

// run the build-step, if npm and the package.json are setup
// async function runBuild (archive) {
//   var localSyncPath = archive.localSyncPath
//   if (!localSyncPath) return // sanity check
//   var scopedFS = scopedFSes.get(localSyncPath)

//   // read the package.json
//   var packageJson
//   try { packageJson = JSON.parse(await readFile(scopedFS, '/package.json')) } catch (e) { return /* abort */ }

//   // make sure there's a watch-build script
//   var watchBuildScript = _get(packageJson, 'scripts.watch-build')
//   if (typeof watchBuildScript !== 'string') return

//   // run the build script
//   var res
//   try {
//     console.log('running watch-build')
//     res = await exec('npm run watch-build', {cwd: localSyncPath})
//   } catch (e) {
//     res = e
//   }
//   await new Promise(r => scopedFS.writeFile(WATCH_BUILD_LOG_PATH, res, () => r()))
// }

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
      if (targetPath.startsWith(filepath) && targetPath.charAt(filepath.length) === '/') {
        return false // a parent folder
      }
    }
    return true
  }
}

function massageDiffOpts (opts) {
  return {
    compareContent: typeof opts.compareContent === 'boolean' ? opts.compareContent : true,
    shallow: typeof opts.shallow === 'boolean' ? opts.shallow : true,
    paths: Array.isArray(opts.paths) ? opts.paths.filter(v => typeof v === 'string') : false,
    addOnly: typeof opts.addOnly === 'boolean' ? opts.addOnly : false
  }
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
