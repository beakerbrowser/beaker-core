const emitStream = require('emit-stream')
const EventEmitter = require('events')
const datEncoding = require('dat-encoding')
const pify = require('pify')
const pda = require('pauls-dat-api')
const signatures = require('sodium-signatures')
const parseDatURL = require('parse-dat-url')
const debounce = require('lodash.debounce')

// dbs
const siteData = require('../dbs/sitedata')
const settingsDb = require('../dbs/settings')
const archivesDb = require('../dbs/archives')

// dat modules
const datGC = require('./garbage-collector')

// file modules
const mkdirp = require('mkdirp')
const scopedFSes = require('../lib/scoped-fses')

// constants
// =

const {
  DAT_HASH_REGEX,
  DAT_PRESERVED_FIELDS_ON_FORK
} = require('../lib/const')
const {InvalidURLError} = require('beaker-error-constants')
const DAT_DAEMON_MANIFEST = require('./daemon/manifest')

// globals
// =

var archives = {} // in-memory cache of archive objects. key -> archive
var archiveLoadPromises = {} // key -> promise
var archivesEvents = new EventEmitter()
var daemon

// exported API
// =

exports.setup = async function setup ({rpcAPI, datDaemonWc, disallowedSavePaths}) {
  // connect to the daemon
  daemon = rpcAPI.importAPI('dat-daemon', DAT_DAEMON_MANIFEST, {wc: datDaemonWc})
  daemon.setup({disallowedSavePaths, datPath: archivesDb.getDatPath()})

  // wire up event handlers
  archivesDb.on('update:archive-user-settings', async (key, userSettings, newUserSettings) => {
    // emit event
    var details = {
      url: 'dat://' + key,
      isSaved: userSettings.isSaved,
      hidden: userSettings.hidden,
      networked: userSettings.networked,
      autoDownload: userSettings.autoDownload,
      autoUpload: userSettings.autoUpload,
      localSyncPath: userSettings.localSyncPath,
      previewMode: userSettings.previewMode
    }
    archivesEvents.emit('updated', {details})
    if ('isSaved' in newUserSettings) {
      archivesEvents.emit(newUserSettings.isSaved ? 'added' : 'removed', {details})
    }

    // delete all perms for deleted archives
    if (!userSettings.isSaved) {
      siteData.clearPermissionAllOrigins('modifyDat:' + key)
    }

    // update the download based on these settings
    daemon.configureArchive(key, userSettings)
  })

  // DAEMON
  // folderSync.events.on('sync', (key, direction) => {
  //   archivesEvents.emit('folder-synced', {
  //     details: {
  //       url: `dat://${datEncoding.toStr(key)}`,
  //       direction
  //     }
  //   })
  // })
  // folderSync.events.on('error', (key, err) => {
  //   archivesEvents.emit('folder-sync-error', {
  //     details: {
  //       url: `dat://${datEncoding.toStr(key)}`,
  //       name: err.name,
  //       message: err.message
  //     }
  //   })
  // })

  // configure the bandwidth throttle
  settingsDb.getAll().then(({dat_bandwidth_limit_up, dat_bandwidth_limit_down}) => {
    daemon.setBandwidthThrottle({
      up: dat_bandwidth_limit_up,
      down: dat_bandwidth_limit_down
    })
  })
  settingsDb.on('set:dat_bandwidth_limit_up', up => daemon.setBandwidthThrottle({up}))
  settingsDb.on('set:dat_bandwidth_limit_down', down => daemon.setBandwidthThrottle({down}))

  // start the GC manager
  datGC.setup()
}

exports.loadSavedArchives = function () {
  // load and configure all saved archives
  return archivesDb.query(0, {isSaved: true}).then(
    async (archives) => {
      // HACK
      // load the archives one at a time and give 5 seconds between each
      // why: the purpose of loading saved archives is to seed them
      // loading them all at once can bog down the user's device
      // if the user tries to access an archive, Beaker will load it immediately
      // so spacing out the loads has no visible impact on the user
      // (except for reducing the overall load for the user)
      // -prf
      for (let a of archives) {
        loadArchive(a.key, a.userSettings)
        await new Promise(r => setTimeout(r, 5e3)) // wait 5s
      }
    },
    err => console.error('Failed to load networked archives', err)
  )
}

exports.createEventStream = function createEventStream () {
  return emitStream(archivesEvents)
}

exports.getDebugLog = function getDebugLog (key) {
  return daemon.getDebugLog(key)
}

exports.createDebugStream = function createDebugStream () {
  // DAEMON
  // return emitStream(debugEvents)
}

// read metadata for the archive, and store it in the meta db
const pullLatestArchiveMeta = exports.pullLatestArchiveMeta = async function pullLatestArchiveMeta (archive, {updateMTime} = {}) {
  try {
    var key = archive.key.toString('hex')

    // ready() just in case (we need .blocks)
    await pify(archive.ready.bind(archive))()

    // read the archive meta and size on disk
    var [manifest, oldMeta] = await Promise.all([
      pda.readManifest(archive).catch(_ => {}),
      archivesDb.getMeta(key),
      // daemon.updateSizeTracking(archive) DAEMON
    ])
    manifest = archive.manifest = manifest || {}
    var {title, description, type} = manifest
    var isOwner = false // archive.writable DAEMON
    var size = archive.size || 0 // DAEMON
    var mtime = updateMTime ? Date.now() : oldMeta.mtime

    // write the record
    var details = {title, description, type, mtime, size, isOwner}
    await archivesDb.setMeta(key, details)

    // emit the updated event
    details.url = 'dat://' + key
    archivesEvents.emit('updated', {details})
    return details
  } catch (e) {
    console.error('Error pulling meta', e)
  }
}

// archive creation
// =

const createNewArchive = exports.createNewArchive = async function createNewArchive (manifest = {}, settings = false) {
  var userSettings = {
    isSaved: !(settings && settings.isSaved === false),
    networked: !(settings && settings.networked === false),
    hidden: settings && settings.hidden === true,
    previewMode: settings && settings.previewMode === true,
    localSyncPath: settings && settings.localSyncPath
  }

  // create the archive
  var archive = await loadArchive(null, userSettings)
  var key = datEncoding.toStr(archive.key)

  // write the manifest and default datignore
  await Promise.all([
    pda.writeManifest(archive, manifest),
    pda.writeFile(archive, '/.datignore', await settingsDb.get('default_dat_ignore'), 'utf8')
  ])

  // write the user settings
  await archivesDb.setUserSettings(0, key, userSettings)

  // write the metadata
  await pullLatestArchiveMeta(archive)

  return `dat://${key}/`
}

exports.forkArchive = async function forkArchive (srcArchiveUrl, manifest = {}, settings = false) {
  srcArchiveUrl = fromKeyToURL(srcArchiveUrl)

  // get the old archive
  var srcArchive = getArchive(srcArchiveUrl)
  if (!srcArchive) {
    throw new Error('Invalid archive key')
  }

  // fetch old archive meta
  var srcManifest = await pda.readManifest(srcArchive).catch(_ => {})
  srcManifest = srcManifest || {}

  // override any manifest data
  var dstManifest = {
    title: (manifest.title) ? manifest.title : srcManifest.title,
    description: (manifest.description) ? manifest.description : srcManifest.description,
    type: (manifest.type) ? manifest.type : srcManifest.type,
    author: manifest.author
  }
  DAT_PRESERVED_FIELDS_ON_FORK.forEach(field => {
    if (srcManifest[field]) {
      dstManifest[field] = srcManifest[field]
    }
  })

  // create the new archive
  var dstArchiveUrl = await createNewArchive(dstManifest, settings)
  var dstArchive = getArchive(dstArchiveUrl)

  // copy files
  var ignore = ['/.dat', '/.git', '/dat.json']
  await pda.exportArchiveToArchive({
    srcArchive,
    dstArchive,
    skipUndownloadedFiles: true,
    ignore
  })

  // write a .datignore if DNE
  try {
    await pda.stat(dstArchive, '/.datignore')
  } catch (e) {
    await pda.writeFile(dstArchive, '/.datignore', await settingsDb.get('default_dat_ignore'), 'utf8')
  }

  return dstArchiveUrl
}

// archive management
// =

const loadArchive = exports.loadArchive = async function loadArchive (key, userSettings = null) {
  // validate key
  var secretKey
  if (key) {
    if (!Buffer.isBuffer(key)) {
      // existing dat
      key = fromURLToKey(key)
      if (!DAT_HASH_REGEX.test(key)) {
        throw new InvalidURLError()
      }
      key = datEncoding.toBuf(key)
    }
  } else {
    // new dat, generate keys
    var kp = signatures.keyPair()
    key = kp.publicKey
    secretKey = kp.secretKey
  }

  // fallback to the promise, if possible
  var keyStr = datEncoding.toStr(key)
  if (keyStr in archiveLoadPromises) {
    return archiveLoadPromises[keyStr]
  }

  // run and cache the promise
  var p = loadArchiveInner(key, secretKey, userSettings)
  archiveLoadPromises[keyStr] = p
  p.catch(err => {
    console.error('Failed to load archive', err)
  })

  // when done, clear the promise
  const clear = () => delete archiveLoadPromises[keyStr]
  p.then(clear, clear)

  return p
}

// main logic, separated out so we can capture the promise
async function loadArchiveInner (key, secretKey, userSettings = null) {
  // load the user settings as needed
  if (!userSettings) {
    try {
      userSettings = await archivesDb.getUserSettings(0, key)
    } catch (e) {
      userSettings = {networked: true}
    }
  }
  if (!('networked' in userSettings)) {
    userSettings.networked = true
  }

  // ensure the folders exist
  var metaPath = archivesDb.getArchiveMetaPath(key)
  mkdirp.sync(metaPath)

  // load the archive in the daemon
  var archiveInfo = await daemon.loadArchive({
    key,
    secretKey,
    metaPath,
    userSettings
  })

  // create the archive proxy instance
  var archive = createArchiveProxy(key, archiveInfo)

  // update db
  archivesDb.touch(key).catch(err => console.error('Failed to update lastAccessTime for archive', key, err))
  await pullLatestArchiveMeta(archive)

  // wire up events
  archive.pullLatestArchiveMeta = debounce(opts => pullLatestArchiveMeta(archive, opts), 1e3)
  // DAEMON
  // archive.fileActStream = pda.watch(archive)
  // archive.fileActStream.on('data', ([event, {path}]) => {
  //   if (event === 'changed') {
  //     archive.pullLatestArchiveMeta({updateMTime: true})
  //     let syncSettings = archive.localSyncSettings
  //     if (syncSettings) {
  //       // need to sync this change to the local folder
  //       if (syncSettings.autoPublish) {
  //         // bidirectional sync: use the sync queue
  //         folderSync.queueSyncEvent(archive, {toFolder: true})
  //       } else {
  //         // preview mode: just write this update to disk
  //         folderSync.syncArchiveToFolder(archive, {paths: [path], shallow: false})
  //       }
  //     }
  //   }
  // })

  // now store in main archives listing, as loaded
  archives[datEncoding.toStr(archive.key)] = archive
  return archive
}

const getArchive = exports.getArchive = function getArchive (key) {
  key = fromURLToKey(key)
  return archives[key]
}

const getArchiveCheckout = exports.getArchiveCheckout = function getArchiveCheckout (archive, version) {
  var isHistoric = false
  var isPreview = false
  var checkoutFS = archive
  // DAEMON
  // if (version) {
  //   let seq = parseInt(version)
  //   if (Number.isNaN(seq)) {
  //     if (version === 'latest') {
  //       // ignore, we use latest by default
  //     } else if (version === 'preview') {
  //       if (archive.localSyncSettings) {
  //         // checkout local sync path
  //         checkoutFS = scopedFSes.get(archive.localSyncSettings.path)
  //         checkoutFS.setFilter(p => folderSync.applyDatIgnoreFilter(archive, p))
  //         isPreview = true
  //       } else {
  //         let err = new Error('Preview mode is not enabled for this dat')
  //         err.noPreviewMode = true
  //         throw err
  //       }
  //     } else {
  //       throw new Error('Invalid version identifier:' + version)
  //     }
  //   } else {
  //     if (seq <= 0) throw new Error('Version too low')
  //     if (seq > archive.version) throw new Error('Version too high')
  //     checkoutFS = archive.checkout(seq, {metadataStorageCacheSize: 0, contentStorageCacheSize: 0, treeCacheSize: 0})
  //     isHistoric = true
  //   }
  // }
  return {isHistoric, isPreview, checkoutFS}
}

exports.getActiveArchives = function getActiveArchives () {
  return archives
}

const getOrLoadArchive = exports.getOrLoadArchive = async function getOrLoadArchive (key, opts) {
  var archive = getArchive(key)
  if (archive) {
    return archive
  }
  return loadArchive(key, opts)
}

exports.unloadArchive = async function unloadArchive (key) {
  key = fromURLToKey(key)
  if (!archives[key]) return
  delete archives[key]
  await daemon.unloadArchive(key)
}

const isArchiveLoaded = exports.isArchiveLoaded = function isArchiveLoaded (key) {
  key = fromURLToKey(key)
  return key in archives
}

const updateSizeTracking = exports.updateSizeTracking = async function updateSizeTracking (archive) {
  // DAEMON
  // fetch size
  // archive.size = await pda.readSize(archive, '/')
}

// archive fetch/query
// =

exports.queryArchives = async function queryArchives (query) {
  // run the query
  var archiveInfos = await archivesDb.query(0, query)

  if (query && ('inMemory' in query)) {
    archiveInfos = archiveInfos.filter(archiveInfo => isArchiveLoaded(archiveInfo.key) === query.inMemory)
  }

  // attach some live data
  archiveInfos.forEach(archiveInfo => {
    var archive = getArchive(archiveInfo.key)
    if (archive) {
      archiveInfo.isSwarmed = archiveInfo.userSettings.networked
      archiveInfo.size = 0 // archive.size DAEMON
      archiveInfo.peers = 0 // archive.metadata.peers.length DAEMON
      archiveInfo.peerHistory = [] // archive.peerHistory DAEMON
    } else {
      archiveInfo.isSwarmed = false
      archiveInfo.peers = 0
      archiveInfo.peerHistory = []
    }
  })
  return archiveInfos
}

exports.getArchiveInfo = async function getArchiveInfo (key) {
  // get the archive
  key = fromURLToKey(key)
  var archive = await getOrLoadArchive(key)

  // fetch archive data
  var [meta, userSettings] = await Promise.all([
    archivesDb.getMeta(key),
    archivesDb.getUserSettings(0, key)
  ])
  meta.key = key
  meta.url = `dat://${key}`
  meta.links = {} // archive.manifest.links || {} DAEMON
  meta.manifest = {} // archive.manifest DAEMON
  meta.version = 1 // archive.version DAEMON
  meta.size = 1 // archive.size DAEMON
  meta.userSettings = {
    isSaved: userSettings.isSaved,
    hidden: userSettings.hidden,
    networked: userSettings.networked,
    autoDownload: userSettings.autoDownload,
    autoUpload: userSettings.autoUpload,
    expiresAt: userSettings.expiresAt,
    localSyncPath: userSettings.localSyncPath,
    previewMode: userSettings.previewMode
  }
  meta.peers = 0 // archive.metadata.peers.length DAEMON
  meta.peerInfo = [] // getArchivePeerInfos(archive) DAEMON
  meta.peerHistory = [] // archive.peerHistory DAEMON
  meta.networkStats = {} // archive.networkStats DAEMON

  return meta
}

exports.clearFileCache = async function clearFileCache (key) {
  var userSettings = await archivesDb.getUserSettings(0, key)
  return daemon.clearFileCache(key, userSettings)
}

// helpers
// =

const fromURLToKey = exports.fromURLToKey = function fromURLToKey (url) {
  if (Buffer.isBuffer(url)) {
    return url
  }
  if (DAT_HASH_REGEX.test(url)) {
    // simple case: given the key
    return url
  }

  var urlp = parseDatURL(url)

  // validate
  if (urlp.protocol !== 'dat:') {
    throw new InvalidURLError('URL must be a dat: scheme')
  }
  if (!DAT_HASH_REGEX.test(urlp.host)) {
    // TODO- support dns lookup?
    throw new InvalidURLError('Hostname is not a valid hash')
  }

  return urlp.host
}

const fromKeyToURL = exports.fromKeyToURL = function fromKeyToURL (key) {
  if (typeof key !== 'string') {
    key = datEncoding.toStr(key)
  }
  if (!key.startsWith('dat://')) {
    return `dat://${key}/`
  }
  return key
}

// archive proxy
// =

function makeArchiveProxyCbFn (key, method) {
  return (...args) => daemon.callArchiveAsyncMethod(key, method, ...args)
}

function makeArchiveProxyReadStreamFn (key, method) {
  return (...args) => daemon.callArchiveReadStreamMethod(key, method, ...args)
}

function makeArchiveProxyWriteStreamFn (key, method) {
  return (...args) => daemon.callArchiveWriteStreamMethod(key, method, ...args)
}

function createArchiveProxy (key, archiveInfo) {
  key = datEncoding.toStr(key)
  const stat = makeArchiveProxyCbFn(key, 'stat')
  return {
    key: datEncoding.toBuf(key),

    // DAEMON
    version: 0,
    writable: false,
    discoveryKey: null,

    ready: makeArchiveProxyCbFn(key, 'ready'),
    download: makeArchiveProxyCbFn(key, 'download'),
    history: makeArchiveProxyReadStreamFn(key, 'history'),
    createReadStream: makeArchiveProxyReadStreamFn(key, 'createReadStream'),
    readFile: makeArchiveProxyCbFn(key, 'readFile'),
    createDiffStream: makeArchiveProxyReadStreamFn(key, 'createDiffStream'),
    createWriteStream: makeArchiveProxyWriteStreamFn(key, 'createWriteStream'),
    writeFile: makeArchiveProxyCbFn(key, 'writeFile'),
    unlink: makeArchiveProxyCbFn(key, 'unlink'),
    mkdir: makeArchiveProxyCbFn(key, 'mkdir'),
    rmdir: makeArchiveProxyCbFn(key, 'rmdir'),
    readdir: makeArchiveProxyCbFn(key, 'readdir'),
    stat: (...args) => {
      var cb = args.pop()
      args.push((err, st) => {
        if (st) {
          // turn into proper stat object
          st.atime = new Date(st.atime)
          st.mtime = new Date(st.mtime)
          st.ctime = new Date(st.ctime)
          st.isSocket = () => false
          st.isSymbolicLink = () => false
          st.isFile = () => st.mode & 32768 === 32768
          st.isBlockDevice = () => false
          st.isDirectory = () => st.mode & 16384 === 16384
          st.isCharacterDevice = () => false
          st.isFIFO = () => false
        }
        cb(err, st)
      })
      stat(...args)
    },
    lstat: makeArchiveProxyCbFn(key, 'lstat'),
    access: makeArchiveProxyCbFn(key, 'access')
  }
}
