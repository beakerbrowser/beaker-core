const crypto = require('crypto')
const EventEmitter = require('events')
const emitStream = require('emit-stream')
const CircularAppendFile = require('circular-append-file')
const through = require('through2')
const split = require('split2')
const concat = require('concat-stream')
const throttle = require('lodash.throttle')
const isEqual = require('lodash.isequal')
const pump = require('pump')
const jetpack = require('fs-jetpack')
const {join} = require('path')

// dat modules
const hyperdrive = require('hyperdrive')
const hypercoreProtocol = require('hypercore-protocol')
const pda = require('pauls-dat-api')
const datEncoding = require('dat-encoding')

// network modules
const swarmDefaults = require('datland-swarm-defaults')
const discoverySwarm = require('discovery-swarm')
const networkSpeed = require('hyperdrive-network-speed')
const {ThrottleGroup} = require('stream-throttle')

const datStorage = require('./storage')
const folderSync = require('./folder-sync')
const {addArchiveSwarmLogging} = require('./logging-utils')
const datExtensions = require('./extensions')
const {DAT_SWARM_PORT} = require('../../lib/const')
const RPC_MANIFEST = require('./manifest')

// globals
// =

var datPath
var networkId = crypto.randomBytes(32)
var archives = {} // in-memory cache of archive objects. key -> archive
var archivesByDKey = {} // same, but discoveryKey -> archive
var archiveLoadPromises = {} // key -> promise
var daemonEvents = new EventEmitter()
var debugEvents = new EventEmitter()
var debugLogFile
var archiveSwarm

var upThrottleGroup
var downThrottleGroup

// exported api
// =

exports.setup = async function ({rpcAPI, logfilePath}) {
  // export API
  rpcAPI.exportAPI('dat-daemon', RPC_MANIFEST, RPC_API)

  // setup storage
  await datStorage.setup()
  debugLogFile = CircularAppendFile(logfilePath, {maxSize: 1024 /* 1kb */ * 1024 /* 1mb */ * 50 /* 50mb */ })

  // setup extension messages
  datExtensions.setup()

  // re-export events
  folderSync.events.on('sync', (key, direction) => {
    daemonEvents.emit('folder-synced', {
      details: {
        url: `dat://${datEncoding.toStr(key)}`,
        direction
      }
    })
  })
  folderSync.events.on('error', (key, err) => {
    daemonEvents.emit('folder-sync-error', {
      details: {
        url: `dat://${datEncoding.toStr(key)}`,
        name: err.name,
        message: err.message
      }
    })
  })

  // setup the archive swarm
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
}

// rpc api
// =

const RPC_API = {
  // setup & config
  // =

  async setup (opts) {
    datPath = opts.datPath
    folderSync.setup(opts)
  },

  // up/down are in MB/s
  async setBandwidthThrottle ({up, down}) {
    if (typeof up !== 'undefined') {
      upThrottleGroup = up ? new ThrottleGroup({rate: up * 1e6}) : null
    }
    if (typeof down !== 'undefined') {
      downThrottleGroup = down ? new ThrottleGroup({rate: down * 1e6}) : null
    }
  },

  // event streams & debug
  // =

  createEventStream () {
    return emitStream(daemonEvents)
  },

  createDebugStream () {
    return emitStream(debugEvents)
  },

  async getDebugLog (key) {
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
  },

  // archive management
  // =

  async configureArchive (key, userSettings) {
    var archive = getArchive(key)
    if (archive) {
      configureNetwork(archive, userSettings)
      configureAutoDownload(archive, userSettings)
      configureLocalSync(archive, userSettings)
    }
  },

  async getArchiveInfo (key) {
    var archive = getArchive(key)
    if (!archive) return {}
    return {
      version: archive.version,
      size: archive.size,
      peers: archive.metadata.peers.length,
      peerInfo: getArchivePeerInfos(archive),
      peerHistory: archive.peerHistory,
      networkStats: archive.networkStats
    }
  },

  updateSizeTracking,

  async loadArchive (opts) {
    var {
      key,
      secretKey,
      metaPath,
      userSettings
    } = opts

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

    // attach extensions
    datExtensions.attach(archive)

    // store in the discovery listing, so the swarmer can find it
    // but not yet in the regular archives listing, because it's not fully loaded
    var discoveryKey = datEncoding.toStr(archive.discoveryKey)
    archivesByDKey[discoveryKey] = archive

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

    // store in the archives list
    archives[datEncoding.toStr(archive.key)] = archive

    // return some archive info
    return {discoveryKey, writable: archive.writable}
  },

  async unloadArchive (key) {
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
  },

  // archive methods
  // =

  callArchiveAsyncMethod (key, method, ...args) {
    var cb = args.slice(-1)[0]
    var archive = archives[key]
    if (!archive) cb(new Error('Archive not loaded: ' + key))
    archive[method](...args)
  },

  callArchiveReadStreamMethod (key, method, ...args) {
    var archive = archives[key]
    if (!archive) throw new Error('Archive not loaded: ' + key)
    return archive[method](...args)
  },

  callArchiveWriteStreamMethod (key, method, ...args) {
    var archive = archives[key]
    if (!archive) throw new Error('Archive not loaded: ' + key)
    return archive[method](...args)
  },

  async clearFileCache (key, userSettings) {
    var archive = await getArchive(key)
    if (!archive || archive.writable) {
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
    stopAutodownload(archive)
    configureAutoDownload(archive, userSettings)
  },

  // folder sync
  // =

  fs_assertSafePath: folderSync.assertSafePath,
  fs_ensureSyncFinished: folderSync.ensureSyncFinished,
  fs_diffListing: folderSync.diffListing,
  fs_diffFile: folderSync.diffFile,
  fs_syncFolderToArchive: folderSync.syncFolderToArchive,
  fs_syncArchiveToFolder: folderSync.syncArchiveToFolder
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

// internal methods
// =

function getArchive (key) {
  if (key.key) return key // we were given an archive
  return archives[key]
}

async function updateSizeTracking (archive) {
  archive = getArchive(archive)
  archive.size = await pda.readSize(archive, '/')
  return archive.size
}

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
    jetpack.removeAsync(getInternalLocalSyncPath(archive))
  }
}

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

  daemonEvents.emit('network-changed', {
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

function getInternalLocalSyncPath (archiveOrKey) {
  var key = datEncoding.toStr(archiveOrKey.key || archiveOrKey)
  return join(datPath, 'Archives', 'LocalCopy', key.slice(0, 2), key.slice(2))
}

// helpers
// =

function log (key, data) {
  var keys = Array.isArray(key) ? key : [key]
  keys.forEach(k => {
    let data2 = Object.assign(data, {archiveKey: k})
    debugEvents.emit(k, data2)
    debugEvents.emit('all', data2)
  })
  if (keys[0]) {
    debugLogFile.append(keys[0] + JSON.stringify(data) + '\n')
  }
}