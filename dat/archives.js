const emitStream = require('emit-stream')
const EventEmitter = require('events')
const datEncoding = require('dat-encoding')
const parseDatURL = require('parse-dat-url')
const _debounce = require('lodash.debounce')
const pda = require('pauls-dat-api2')
const baseLogger = require('../logger').get()
const logger = baseLogger.child({category: 'dat', subcategory: 'archives'})

// dbs
const siteData = require('../dbs/sitedata')
const settingsDb = require('../dbs/settings')
const archivesDb = require('../dbs/archives')
const datDnsDb = require('../dbs/dat-dns')

// dat modules
const daemon = require('./daemon')
const datAssets = require('./assets')

// constants
// =

const {
  DAT_HASH_REGEX,
  DAT_PRESERVED_FIELDS_ON_FORK
} = require('../lib/const')
const {InvalidURLError, TimeoutError} = require('beaker-error-constants')

// typedefs
// =

/**
 * @typedef {import('../dbs/archives').LibraryArchiveRecord} LibraryArchiveRecord
 * @typedef {import('./daemon').DaemonDatArchive} DaemonDatArchive
 */

// globals
// =

var archives = {} // in-memory cache of archive objects. key -> archive
var archiveLoadPromises = {} // key -> promise
var archiveSessionCheckouts = {} // key+version -> DaemonDatArchive
var archivesEvents = new EventEmitter()
// var daemonEvents TODO

// exported API
// =

exports.on = archivesEvents.on.bind(archivesEvents)
exports.addListener = archivesEvents.addListener.bind(archivesEvents)
exports.removeListener = archivesEvents.removeListener.bind(archivesEvents)

/**
 * @param {Object} opts
 * @param {Object} opts.rpcAPI
 * @param {Object} opts.datDaemonProcess
 * @param {string[]} opts.disallowedSavePaths
 * @return {Promise<void>}
 */
exports.setup = async function setup ({rpcAPI, disallowedSavePaths}) {
  // connect to the daemon
  await daemon.setup()

  datDnsDb.on('updated', ({key, name}) => {
    var archive = getArchive(key)
    if (archive) {
      archive.domain = name
    }
  })

  // re-export events
  // TODO
  // daemonEvents.on('network-changed', evt => archivesEvents.emit('network-changed', evt))

  // configure the bandwidth throttle
  // TODO
  // settingsDb.getAll().then(({dat_bandwidth_limit_up, dat_bandwidth_limit_down}) => {
  //   daemon.setBandwidthThrottle({
  //     up: dat_bandwidth_limit_up,
  //     down: dat_bandwidth_limit_down
  //   })
  // })
  // settingsDb.on('set:dat_bandwidth_limit_up', up => daemon.setBandwidthThrottle({up}))
  // settingsDb.on('set:dat_bandwidth_limit_down', down => daemon.setBandwidthThrottle({down}))

  logger.info('Initialized dat daemon')
}

/**
 * @returns {Promise<void>}
 */
exports.loadSavedArchives = async function () {
  // load all saved archives
  var archives = require('../filesystem/dat-library').query({isHosting: true})
  // HACK
  // load the archives one at a time and give 5 seconds between each
  // why: the purpose of loading saved archives is to seed them
  // loading them all at once can bog down the user's device
  // if the user tries to access an archive, Beaker will load it immediately
  // so spacing out the loads has no visible impact on the user
  // (except for reducing the overall load for the user)
  // -prf
  for (let a of archives) {
    loadArchive(a.key)
    await new Promise(r => setTimeout(r, 5e3)) // wait 5s
  }
}

/**
 * @returns {NodeJS.ReadableStream}
 */
exports.createEventStream = function createEventStream () {
  return emitStream.toStream(archivesEvents)
}

/**
 * @param {string} key
 * @returns {Promise<string>}
 */
exports.getDebugLog = function getDebugLog (key) {
  return '' // TODO needed? daemon.getDebugLog(key)
}

/**
 * @returns {NodeJS.ReadableStream}
 */
exports.createDebugStream = function createDebugStream () {
  // TODO needed?
  // return daemon.createDebugStream()
}

// read metadata for the archive, and store it in the meta db
const pullLatestArchiveMeta = exports.pullLatestArchiveMeta = async function pullLatestArchiveMeta (archive, {updateMTime} = {}) {
  try {
    var key = archive.key.toString('hex')

    // trigger DNS update
    confirmDomain(key)

    // read the archive meta and size on disk
    var [manifest, oldMeta, size] = await Promise.all([
      archive.pda.readManifest().catch(_ => {}),
      archivesDb.getMeta(key),
      archive.pda.readSize('/')
    ])
    var {title, description, type, author, forkOf} = (manifest || {})
    var isOwner = archive.writable
    var mtime = updateMTime ? Date.now() : oldMeta.mtime
    var details = {title, description, type, mtime, size, author, forkOf, isOwner}

    // check for changes
    if (!hasMetaChanged(details, oldMeta)) {
      return
    }

    // write the record
    await archivesDb.setMeta(key, details)

    // emit the updated event
    details.url = 'dat://' + key
    archivesEvents.emit('updated', {key, details, oldMeta})
    return details
  } catch (e) {
    console.error('Error pulling meta', e)
  }
}

// archive creation
// =

/**
 * @returns {Promise<DaemonDatArchive>}
 */
exports.createNewRootArchive = async function () {
  var archive = await loadArchive(null, {visibility: 'private'})
  await pullLatestArchiveMeta(archive)
  return archive
}

/**
 * @param {Object} [manifest]
 * @returns {Promise<DaemonDatArchive>}
 */
const createNewArchive = exports.createNewArchive = async function (manifest = {}) {
  // create the archive
  var archive = await loadArchive(null)

  // write the manifest and default datignore
  await Promise.all([
    archive.pda.writeManifest(manifest),
    archive.pda.writeFile('/.datignore', await settingsDb.get('default_dat_ignore'), 'utf8')
  ])

  // save the metadata
  await pullLatestArchiveMeta(archive)

  return archive
}

/**
 * @param {string} srcArchiveUrl
 * @param {Object} [manifest]
 * @returns {Promise<DaemonDatArchive>}
 */
exports.forkArchive = async function forkArchive (srcArchiveUrl, manifest = {}) {
  srcArchiveUrl = fromKeyToURL(srcArchiveUrl)

  // get the source archive
  var srcArchive
  var downloadRes = await Promise.race([
    (async function () {
      srcArchive = await getOrLoadArchive(srcArchiveUrl)
      if (!srcArchive) {
        throw new Error('Invalid archive key')
      }
      return srcArchive.pda.download('/')
    })(),
    new Promise(r => setTimeout(() => r('timeout'), 60e3))
  ])
  if (downloadRes === 'timeout') {
    throw new TimeoutError('Timed out while downloading source archive')
  }

  // fetch source archive meta
  var srcManifest = await srcArchive.pda.readManifest().catch(_ => {})
  srcManifest = srcManifest || {}

  // override any manifest data
  var dstManifest = {
    title: (manifest.title) ? manifest.title : srcManifest.title,
    description: (manifest.description) ? manifest.description : srcManifest.description,
    type: (manifest.type) ? manifest.type : srcManifest.type,
    author: manifest.author,
    forkOf: srcArchiveUrl
  }
  DAT_PRESERVED_FIELDS_ON_FORK.forEach(field => {
    if (srcManifest[field]) {
      dstManifest[field] = srcManifest[field]
    }
  })

  // create the new archive
  var dstArchive = await createNewArchive(dstManifest)

  // copy files
  var ignore = ['/.dat', '/.git', '/dat.json']
  await pda.exportArchiveToArchive({
    srcArchive: srcArchive.session.drive,
    dstArchive: dstArchive.session.drive,
    skipUndownloadedFiles: true,
    ignore
  })

  // write a .datignore if DNE
  try {
    await dstArchive.pda.stat('/.datignore')
  } catch (e) {
    await dstArchive.pda.writeFile('/.datignore', await settingsDb.get('default_dat_ignore'), 'utf8')
  }

  return dstArchive
}

// archive management
// =

const loadArchive = exports.loadArchive = async function loadArchive (key, settingsOverride) {
  // validate key
  if (key) {
    if (!Buffer.isBuffer(key)) {
      // existing dat
      key = await fromURLToKey(key, true)
      if (!DAT_HASH_REGEX.test(key)) {
        throw new InvalidURLError()
      }
      key = datEncoding.toBuf(key)
    }
  }

  // fallback to the promise, if possible
  var keyStr = key ? datEncoding.toStr(key) : null
  if (keyStr && keyStr in archiveLoadPromises) {
    return archiveLoadPromises[keyStr]
  }

  // run and cache the promise
  var p = loadArchiveInner(key, settingsOverride)
  if (key) archiveLoadPromises[keyStr] = p
  p.catch(err => {
    console.error('Failed to load archive', keyStr, err.toString())
  })

  // when done, clear the promise
  if (key) {
    const clear = () => delete archiveLoadPromises[keyStr]
    p.then(clear, clear)
  }

  return p
}

// main logic, separated out so we can capture the promise
async function loadArchiveInner (key, settingsOverride) {
  // ensure the folders exist
  // TODO needed?
  // var metaPath = archivesDb.getArchiveMetaPath(key)
  // mkdirp.sync(metaPath)

  // create the archive session with the daemon
  var archive = await daemon.createDatArchiveSession({key})
  key = archive.key
  var keyStr = datEncoding.toStr(archive.key)

  // fetch library settings
  var userSettings = require('../filesystem/dat-library').getConfig(keyStr)
  if (!userSettings) {
    if (require('../filesystem/users').isUser(archive.url)) {
      userSettings = {key: keyStr, isSaved: true, isHosting: true, visibility: 'unlisted', savedAt: null, meta: null}
    }
  }
  if (settingsOverride) {
    userSettings = Object.assign(userSettings || {}, settingsOverride)
  }

  // put the archive on the network
  if (!userSettings || userSettings.visibility !== 'private') {
    archive.session.publish()
  }

  // fetch dns name if known
  let dnsRecord = await datDnsDb.getCurrentByKey(datEncoding.toStr(key))
  archive.domain = dnsRecord ? dnsRecord.name : undefined

  // update db
  archivesDb.touch(archive.key).catch(err => console.error('Failed to update lastAccessTime for archive', archive.key, err))
  await pullLatestArchiveMeta(archive)
  datAssets.update(archive)

  // wire up events
  archive.pullLatestArchiveMeta = _debounce(opts => pullLatestArchiveMeta(archive, opts), 1e3)
  archive.fileActStream = archive.pda.watch('/')
  archive.fileActStream.on('data', ([event, {path}]) => {
    if (event !== 'changed') return
    archive.pullLatestArchiveMeta({updateMTime: true})
    datAssets.update(archive, [path])
  })

  // now store in main archives listing, as loaded
  archives[keyStr] = archive
  return archive
}

const getArchive = exports.getArchive = function getArchive (key) {
  key = fromURLToKey(key)
  return archives[key]
}

exports.getArchiveCheckout = async function getArchiveCheckout (archive, version) {
  var isHistoric = false
  var checkoutFS = archive
  if (typeof version !== 'undefined' && version !== null) {
    let seq = parseInt(version)
    if (Number.isNaN(seq)) {
      if (version === 'latest') {
        // ignore, we use latest by default
      } else {
        throw new Error('Invalid version identifier:' + version)
      }
    } else {
      let checkoutKey = `${archive.key}+${version}`
      if (!(checkoutKey in archiveSessionCheckouts)) {
        archiveSessionCheckouts[checkoutKey] = await daemon.createDatArchiveSession({
          key: archive.key,
          version,
          writable: false
        })
      }
      checkoutFS = archiveSessionCheckouts[checkoutKey]
      checkoutFS.domain = archive.domain
      isHistoric = true
    }
  }
  return {isHistoric, checkoutFS}
}

exports.getActiveArchives = function getActiveArchives () {
  return archives
}

const getOrLoadArchive = exports.getOrLoadArchive = async function getOrLoadArchive (key) {
  key = await fromURLToKey(key, true)
  var archive = getArchive(key)
  if (archive) {
    return archive
  }
  return loadArchive(key)
}

exports.unloadArchive = async function unloadArchive (key) {
  key = await fromURLToKey(key, true)
  var archive = archives[key]
  if (!archive) return
  if (archive.fileActStream) {
    archive.fileActStream.close()
    archive.fileActStream = null
  }
  delete archives[key]
  archive.session.unpublish()
  archive.session.close()
}

const isArchiveLoaded = exports.isArchiveLoaded = function isArchiveLoaded (key) {
  key = fromURLToKey(key)
  return key in archives
}

// archive fetch/query
// =

exports.getArchiveInfo = async function getArchiveInfo (key) {
  // get the archive
  key = await fromURLToKey(key, true)
  var archive = await getOrLoadArchive(key)

  // fetch archive data
  var userSettings = require('../filesystem/dat-library').getConfig(key)
  var [meta, manifest, archiveInfo] = await Promise.all([
    archivesDb.getMeta(key),
    archive.pda.readManifest().catch(_ => {}),
    archive.getInfo()
  ])
  manifest = manifest || {}
  meta.key = key
  meta.url = archive.url
  meta.domain = archive.domain
  meta.links = manifest.links || {}
  meta.manifest = manifest
  meta.version = archiveInfo.version
  meta.userSettings = {
    isSaved: userSettings ? true : false,
    isHosting: userSettings ? userSettings.isHosting : false,
    visibility: userSettings ? userSettings.visibility : undefined,
    savedAt: userSettings ? userSettings.savedAt : null
  }
  meta.peers = archiveInfo.peers
  meta.networkStats = archiveInfo.networkStats

  return meta
}

exports.getArchiveNetworkStats = async function getArchiveNetworkStats (key) {
  key = await fromURLToKey(key, true)
  return {} // TODO daemon.getArchiveNetworkStats(key)
}

exports.clearFileCache = async function clearFileCache (key) {
  return {} // TODO daemon.clearFileCache(key, userSettings)
}

/**
 * @desc
 * Get the primary URL for a given dat URL
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
const getPrimaryUrl = exports.getPrimaryUrl = async function (url) {
  var key = await fromURLToKey(url, true)
  var datDnsRecord = await datDnsDb.getCurrentByKey(key)
  if (!datDnsRecord) return `dat://${key}`
  return `dat://${datDnsRecord.name}`
}

/**
 * @desc
 * Check that the archive's dat.json `domain` matches the current DNS
 * If yes, write the confirmed entry to the dat_dns table
 *
 * @param {string} key
 * @returns {Promise<boolean>}
 */
const confirmDomain = exports.confirmDomain = async function (key) {
  // fetch the current domain from the manifest
  try {
    var archive = await getOrLoadArchive(key)
    var datJson = await archive.pda.readManifest()
  } catch (e) {
    return false
  }
  if (!datJson.domain) {
    await datDnsDb.unset(key)
    return false
  }

  // confirm match with current DNS
  var dnsKey = await require('./dns').resolveName(datJson.domain)
  if (key !== dnsKey) {
    await datDnsDb.unset(key)
    return false
  }

  // update mapping
  await datDnsDb.update({name: datJson.domain, key})
  return true
}

// helpers
// =

const fromURLToKey = exports.fromURLToKey = function fromURLToKey (url, lookupDns = false) {
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
    if (!lookupDns) {
      throw new InvalidURLError('Hostname is not a valid hash')
    }
    return require('./dns').resolveName(urlp.host)
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

function hasMetaChanged (m1, m2) {
  for (let k of ['title', 'description', 'type', 'size', 'author', 'forkOf']) {
    if (!m1[k] !== !m2[k] && m1[k] !== m2[k]) {
      return true
    }
  }
  return false
}