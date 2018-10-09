const crypto = require('crypto')
const emitStream = require('emit-stream')
const EventEmitter = require('events')
const datEncoding = require('dat-encoding')
const pify = require('pify')
const pda = require('pauls-dat-api')
const signatures = require('sodium-signatures')
const parseDatURL = require('parse-dat-url')
const through = require('through2')
const split = require('split2')
const concat = require('concat-stream')
const CircularAppendFile = require('circular-append-file')
const debug = require('../lib/debug-logger').debugLogger('dat')
const throttle = require('lodash.throttle')
const debounce = require('lodash.debounce')
const isEqual = require('lodash.isequal')
const pump = require('pump')
const siteData = require('../dbs/sitedata')
const settingsDb = require('../dbs/settings')

// dat modules
const archivesDb = require('../dbs/archives')
const datStorage = require('./storage')
const datGC = require('./garbage-collector')
const folderSync = require('./folder-sync')
const {addArchiveSwarmLogging} = require('./logging-utils')
const datExtensions = require('./extensions')
const hypercoreProtocol = require('hypercore-protocol')
const hyperdrive = require('hyperdrive')

// network modules
const swarmDefaults = require('datland-swarm-defaults')
const discoverySwarm = require('discovery-swarm')
const networkSpeed = require('hyperdrive-network-speed')
const {ThrottleGroup} = require('stream-throttle')

// file modules
const mkdirp = require('mkdirp')
const jetpack = require('fs-jetpack')
const scopedFSes = require('../lib/scoped-fses')

// constants
// =

const {
  DAT_HASH_REGEX,
  DAT_SWARM_PORT,
  DAT_PRESERVED_FIELDS_ON_FORK
} = require('../lib/const')
const {InvalidURLError} = require('beaker-error-constants')

// globals
// =

var networkId = crypto.randomBytes(32)
var archives = {} // in-memory cache of archive objects. key -> archive
var archivesByDKey = {} // same, but discoveryKey -> archive
var archiveLoadPromises = {} // key -> promise
var archivesEvents = new EventEmitter()
var debugEvents = new EventEmitter()
var debugLogFile
var archiveSwarm

var upThrottleGroup
var downThrottleGroup

// exported API
// =

exports.setup = async function setup ({logfilePath}) {
  await datStorage.setup()
  debugLogFile = CircularAppendFile(logfilePath, {maxSize: 1024 /* 1kb */ * 1024 /* 1mb */ * 50 /* 50mb */ })

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
    var archive = getArchive(key)
    if (archive) {
      configureNetwork(archive, userSettings)
      configureAutoDownload(archive, userSettings)
      configureLocalSync(archive, userSettings)
    }
  })
  folderSync.events.on('sync', (key, direction) => {
    archivesEvents.emit('folder-synced', {
      details: {
        url: `dat://${datEncoding.toStr(key)}`,
        direction
      }
    })
  })
  folderSync.events.on('error', (key, err) => {
    archivesEvents.emit('folder-sync-error', {
      details: {
        url: `dat://${datEncoding.toStr(key)}`,
        name: err.name,
        message: err.message
      }
    })
  })

  // configure the bandwidth throttle
  settingsDb.getAll().then(({dat_bandwidth_limit_up, dat_bandwidth_limit_down}) => {
    setBandwidthThrottle({
      up: dat_bandwidth_limit_up,
      down: dat_bandwidth_limit_down
    })
  })
  settingsDb.on('set:dat_bandwidth_limit_up', up => setBandwidthThrottle({up}))
  settingsDb.on('set:dat_bandwidth_limit_down', down => setBandwidthThrottle({down}))

  // setup extension messages
  datExtensions.setup()

  // setup the archive swarm
  datGC.setup()
  archiveSwarm = discoverySwarm(swarmDefaults({
    id: networkId,
    hash: false,
    utp: true,
    tcp: true,
    dht: false,
    connect: connectReplicationStream,
    stream: createReplicationStream
  }))
  addArchiveSwarmLogging({archivesByDKey, log, archiveSwarm})
  archiveSwarm.once('error', () => archiveSwarm.listen(0))
  archiveSwarm.listen(DAT_SWARM_PORT)
  archiveSwarm.on('error', error => log(null, {event: 'swarm-error', message: error.toString()}))

  // load and configure all saved archives
  archivesDb.query(0, {isSaved: true}).then(
    archives => archives.forEach(a => loadArchive(a.key, a.userSettings)),
    err => console.error('Failed to load networked archives', err)
  )
}

// up/down are in MB/s
const setBandwidthThrottle = exports.setBandwidthThrottle = function ({up, down}) {
  if (typeof up !== 'undefined') {
    debug(`Throttling upload to ${up} MB/s`)
    upThrottleGroup = up ? new ThrottleGroup({rate: up * 1e6}) : null
  }
  if (typeof down !== 'undefined') {
    debug(`Throttling download to ${down} MB/s`)
    downThrottleGroup = down ? new ThrottleGroup({rate: down * 1e6}) : null
  }
}

exports.createEventStream = function createEventStream () {
  return emitStream(archivesEvents)
}

exports.getDebugLog = function getDebugLog (key) {
  return new Promise((resolve, reject) => {
    let rs = debugLogFile.createReadStream()
    rs
      .pipe(split())
      .pipe(through({encoding: 'utf8', decodeStrings: false}, (data, _, cb) => {
        if (data && (!key || data.startsWith(key))) {
          return cb(null, data.slice(64) + '\n')
        }
        cb()
      }))
      .pipe(concat({encoding: 'string'}, resolve))
    rs.on('error', reject)
  })
}

exports.createDebugStream = function createDebugStream () {
  return emitStream(debugEvents)
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
      updateSizeTracking(archive)
    ])
    manifest = archive.manifest = manifest || {}
    var {title, description, type} = manifest
    var isOwner = archive.writable
    var size = archive.size || 0
    var mtime = updateMTime ? Date.now() : oldMeta.mtime

    // write the record
    var details = {title, description, type, mtime, size, isOwner}
    debug('Writing meta', details)
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

  // create the archive instance
  var archive = hyperdrive(datStorage.create(metaPath), key, {
    sparse: true,
    secretKey,
    metadataStorageCacheSize: 0,
    contentStorageCacheSize: 0,
    treeCacheSize: 2048
  })
  archive.on('error', err => {
    let k = key.toString('hex')
    log(k, {event: 'archive-error', message: err.toString()})
    console.error('Error in archive', k, err)
    debug('Error in archive', k, err)
  })
  archive.metadata.on('peer-add', () => onNetworkChanged(archive))
  archive.metadata.on('peer-remove', () => onNetworkChanged(archive))
  archive.networkStats = networkSpeed(archive)
  archive.replicationStreams = [] // list of all active replication streams
  archive.peerHistory = [] // samples of the peer count

  // wait for ready
  await new Promise((resolve, reject) => {
    archive.ready(err => {
      if (err) reject(err)
      else resolve()
    })
  })
  await updateSizeTracking(archive)
  archivesDb.touch(key).catch(err => console.error('Failed to update lastAccessTime for archive', key, err))

  // attach extensions
  datExtensions.attach(archive)

  // store in the discovery listing, so the swarmer can find it
  // but not yet in the regular archives listing, because it's not fully loaded
  archivesByDKey[datEncoding.toStr(archive.discoveryKey)] = archive

  // setup the archive based on current settings
  configureNetwork(archive, userSettings)
  configureAutoDownload(archive, userSettings)
  configureLocalSync(archive, userSettings)

  // await initial metadata sync if not the owner
  if (!archive.writable && !archive.metadata.length) {
    // wait to receive a first update
    await new Promise((resolve, reject) => {
      archive.metadata.update(err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
  if (!archive.writable) {
    // always download all metadata
    archive.metadata.download({start: 0, end: -1})
  }

  // pull meta
  await pullLatestArchiveMeta(archive)

  // wire up events
  archive.pullLatestArchiveMeta = debounce(opts => pullLatestArchiveMeta(archive, opts), 1e3)
  archive.fileActStream = pda.watch(archive)
  archive.fileActStream.on('data', ([event, {path}]) => {
    if (event === 'changed') {
      archive.pullLatestArchiveMeta({updateMTime: true})
      let syncSettings = archive.localSyncSettings
      if (syncSettings) {
        // need to sync this change to the local folder
        if (syncSettings.autoPublish) {
          // bidirectional sync: use the sync queue
          folderSync.queueSyncEvent(archive, {toFolder: true})
        } else {
          // preview mode: just write this update to disk
          folderSync.syncArchiveToFolder(archive, {paths: [path], shallow: false})
        }
      }
    }
  })

  // now store in main archives listing, as loaded
  archives[datEncoding.toStr(archive.key)] = archive
  return archive
}

const getArchive = exports.getArchive = function getArchive (key) {
  key = fromURLToKey(key)
  return archives[key]
}

exports.getArchiveCheckout = function getArchiveCheckout (archive, version) {
  var isHistoric = false
  var isPreview = false
  var checkoutFS = archive
  if (version) {
    let seq = parseInt(version)
    if (Number.isNaN(seq)) {
      if (version === 'latest') {
        // ignore, we use latest by default
      } else if (version === 'preview') {
        if (archive.localSyncSettings) {
          // checkout local sync path
          checkoutFS = scopedFSes.get(archive.localSyncSettings.path)
          checkoutFS.setFilter(p => folderSync.applyDatIgnoreFilter(archive, p))
          isPreview = true
        } else {
          let err = new Error('Preview mode is not enabled for this dat')
          err.noPreviewMode = true
          throw err
        }
      } else {
        throw new Error('Invalid version identifier:' + version)
      }
    } else {
      if (seq <= 0) throw new Error('Version too low')
      if (seq > archive.version) throw new Error('Version too high')
      checkoutFS = archive.checkout(seq, {metadataStorageCacheSize: 0, contentStorageCacheSize: 0, treeCacheSize: 0})
      isHistoric = true
    }
  }
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
  const archive = archives[key]
  if (!archive) {
    return
  }

  // shutdown archive
  leaveSwarm(key)
  stopAutodownload(archive)
  if (archive.fileActStream) {
    archive.fileActStream.end()
    archive.fileActStream = null
  }
  datExtensions.detach(archive)
  await new Promise((resolve, reject) => {
    archive.close(err => {
      if (err) reject(err)
      else resolve()
    })
  })
  delete archivesByDKey[datEncoding.toStr(archive.discoveryKey)]
  delete archives[key]
}

const isArchiveLoaded = exports.isArchiveLoaded = function isArchiveLoaded (key) {
  key = fromURLToKey(key)
  return key in archives
}

const updateSizeTracking = exports.updateSizeTracking = async function updateSizeTracking (archive) {
  // fetch size
  archive.size = await pda.readSize(archive, '/')
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
      archiveInfo.size = archive.size
      archiveInfo.peers = archive.metadata.peers.length
      archiveInfo.peerHistory = archive.peerHistory
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
  meta.links = archive.manifest.links || {}
  meta.manifest = archive.manifest
  meta.version = archive.version
  meta.size = archive.size
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
  meta.peers = archive.metadata.peers.length
  meta.peerInfo = getArchivePeerInfos(archive)
  meta.peerHistory = archive.peerHistory
  meta.networkStats = archive.networkStats

  return meta
}

exports.clearFileCache = async function clearFileCache (key) {
  var archive = await getOrLoadArchive(key)
  if (archive.writable) {
    return // abort, only clear the content cache of downloaded archives
  }

  // clear the cache
  await new Promise((resolve, reject) => {
    archive.content.clear(0, archive.content.length, err => {
      if (err) reject(err)
      else resolve()
    })
  })

  // force a reconfig of the autodownloader
  var userSettings = await archivesDb.getUserSettings(0, key)
  stopAutodownload(archive)
  configureAutoDownload(archive, userSettings)
}

// archive networking
// =

// set the networking of an archive based on settings
function configureNetwork (archive, settings) {
  if (!settings || settings.networked) {
    joinSwarm(archive)
  } else {
    leaveSwarm(archive)
  }
}

// put the archive into the network, for upload and download
const joinSwarm = exports.joinSwarm = function joinSwarm (key, opts) {
  var archive = (typeof key === 'object' && key.key) ? key : getArchive(key)
  if (!archive || archive.isSwarming) return
  archiveSwarm.join(archive.discoveryKey)
  var keyStr = datEncoding.toStr(archive.key)
  log(keyStr, {
    event: 'swarming',
    discoveryKey: datEncoding.toStr(archive.discoveryKey)
  })
  archive.isSwarming = true
}

// take the archive out of the network
const leaveSwarm = exports.leaveSwarm = function leaveSwarm (key) {
  var archive = (typeof key === 'object' && key.discoveryKey) ? key : getArchive(key)
  if (!archive || !archive.isSwarming) return

  var keyStr = datEncoding.toStr(archive.key)
  log(keyStr, {
    event: 'unswarming',
    message: `Disconnected ${archive.metadata.peers.length} peers`
  })

  archive.replicationStreams.forEach(stream => stream.destroy()) // stop all active replications
  archive.replicationStreams.length = 0
  archiveSwarm.leave(archive.discoveryKey)
  archive.isSwarming = false
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

const getLocalSyncSettings = exports.getLocalSyncSettings = function getLocalSyncSettings (archive, userSettings) {
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
      path: archivesDb.getInternalLocalSyncPath(archive),
      autoPublish: false,
      isUsingInternal: true
    }
  }
  return false
}

// internal methods
// =

function configureAutoDownload (archive, userSettings) {
  if (archive.writable) {
    return // abort, only used for unwritable
  }
  // HACK
  // mafintosh is planning to put APIs for this inside of hyperdrive
  // till then, we'll do our own inefficient downloader
  // -prf
  const isAutoDownloading = userSettings.isSaved && userSettings.autoDownload
  if (!archive._autodownloader && isAutoDownloading) {
    // setup the autodownload
    archive._autodownloader = {
      undownloadAll: () => {
        if (archive.content) {
          archive.content._selections.forEach(range => archive.content.undownload(range))
        }
      },
      onUpdate: throttle(() => {
        // cancel ALL previous, then prioritize ALL current
        archive._autodownloader.undownloadAll()
        pda.download(archive, '/').catch(e => { /* ignore cancels */ })
      }, 5e3)
    }
    archive.metadata.on('download', archive._autodownloader.onUpdate)
    pda.download(archive, '/').catch(e => { /* ignore cancels */ })
  } else if (archive._autodownloader && !isAutoDownloading) {
    stopAutodownload(archive)
  }
}

function configureLocalSync (archive, userSettings) {
  var oldLocalSyncSettings = archive.localSyncSettings
  archive.localSyncSettings = getLocalSyncSettings(archive, userSettings)

  if (!isEqual(archive.localSyncSettings, oldLocalSyncSettings)) {
    // configure the local folder watcher if a change occurred
    folderSync.configureFolderToArchiveWatcher(archive)
  }

  if (!archive.localSyncSettings || !archive.localSyncSettings.isUsingInternal) {
    // clear the internal directory if it's not in use
    jetpack.removeAsync(archivesDb.getInternalLocalSyncPath(archive))
  }
}

function stopAutodownload (archive) {
  if (archive._autodownloader) {
    archive._autodownloader.undownloadAll()
    archive.metadata.removeListener('download', archive._autodownloader.onUpdate)
    archive._autodownloader = null
  }
}

function connectReplicationStream (local, remote) {
  var streams = [local, remote, local]
  if (upThrottleGroup) streams.splice(1, 0, upThrottleGroup.throttle())
  if (downThrottleGroup) streams.splice(-1, 0, downThrottleGroup.throttle())
  pump(streams)
}

function createReplicationStream (info) {
  // create the protocol stream
  var streamKeys = [] // list of keys replicated over the streamd
  var stream = hypercoreProtocol({
    id: networkId,
    live: true,
    encrypt: true,
    extensions: ['ephemeral', 'session-data']
  })
  stream.peerInfo = info

  // add the archive if the discovery network gave us any info
  if (info.channel) {
    add(info.channel)
  }

  // add any requested archives
  stream.on('feed', add)

  function add (dkey) {
    // lookup the archive
    var dkeyStr = datEncoding.toStr(dkey)
    var archive = archivesByDKey[dkeyStr]
    if (!archive || !archive.isSwarming) {
      return
    }
    if (archive.replicationStreams.indexOf(stream) !== -1) {
      return // already replicating
    }

    // create the replication stream
    archive.replicate({stream, live: true})
    if (stream.destroyed) return // in case the stream was destroyed during setup

    // track the stream
    var keyStr = datEncoding.toStr(archive.key)
    streamKeys.push(keyStr)
    archive.replicationStreams.push(stream)
    function onend () {
      archive.replicationStreams = archive.replicationStreams.filter(s => (s !== stream))
    }
    stream.once('error', onend)
    stream.once('end', onend)
    stream.once('finish', onend)
    stream.once('close', onend)
  }

  // debugging
  stream.on('error', err => {
    log(streamKeys, {
      event: 'connection-error',
      peer: `${info.host}:${info.port}`,
      connectionType: info.type,
      message: err.toString()
    })
  })

  return stream
}

function onNetworkChanged (archive) {
  var now = Date.now()
  var lastHistory = archive.peerHistory.slice(-1)[0]
  if (lastHistory && (now - lastHistory.ts) < 10e3) {
    // if the last datapoint was < 10s ago, just update it
    lastHistory.peers = archive.metadata.peers.length
  } else {
    archive.peerHistory.push({
      ts: Date.now(),
      peers: archive.metadata.peers.length
    })
  }

  // keep peerHistory from getting too long
  if (archive.peerHistory.length >= 500) {
    // downsize to 360 points, which at 10s intervals covers one hour
    archive.peerHistory = archive.peerHistory.slice(archive.peerHistory.length - 360)
  }

  // count # of peers
  var totalPeerCount = 0
  for (var k in archives) {
    totalPeerCount += archives[k].metadata.peers.length
  }
  archivesEvents.emit('network-changed', {
    details: {
      url: `dat://${datEncoding.toStr(archive.key)}`,
      peers: getArchivePeerInfos(archive),
      connections: archive.metadata.peers.length,
      totalPeerCount
    }
  })
}

function getArchivePeerInfos (archive) {
  // old way, more accurate?
  // archive.replicationStreams.map(s => ({host: s.peerInfo.host, port: s.peerInfo.port}))

  return archive.metadata.peers.map(peer => peer.stream.stream.peerInfo).filter(Boolean)
}

function log (key, data) {
  var keys = Array.isArray(key) ? key : [key]
  debug(Object.keys(data).reduce((str, key) => str + `${key}=${data[key]} `, '') + `key=${keys.join(',')}`)
  keys.forEach(k => {
    let data2 = Object.assign(data, {archiveKey: k})
    debugEvents.emit(k, data2)
    debugEvents.emit('all', data2)
  })
  if (keys[0]) {
    debugLogFile.append(keys[0] + JSON.stringify(data) + '\n')
  }
}
