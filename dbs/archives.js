const path = require('path')
const url = require('url')
const mkdirp = require('mkdirp')
const Events = require('events')
const datEncoding = require('dat-encoding')
const jetpack = require('fs-jetpack')
const {InvalidArchiveKeyError} = require('beaker-error-constants')
const db = require('./profile-data-db')
const lock = require('../lib/lock')
const {DAT_HASH_REGEX} = require('../lib/const')

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 *
 * @typedef {Object} LibraryArchiveMeta
 * @prop {string} key
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string} type
 * @prop {number} mtime
 * @prop {number} size
 * @prop {string} author
 * @prop {string} forkOf
 * @prop {boolean} isOwner
 * @prop {number} lastAccessTime
 * @prop {number} lastLibraryAccessTime
 *
 * @typedef {Object} MinimalLibraryArchiveRecord
 * @prop {string} key
 */

// globals
// =

var datPath /** @type string - path to the dat folder */
var events = new Events()

// exported methods
// =

/**
 * @param {Object} opts
 * @param {string} opts.userDataPath
 */
exports.setup = function (opts) {
  // make sure the folders exist
  datPath = path.join(opts.userDataPath, 'Dat')
  mkdirp.sync(path.join(datPath, 'Archives'))
}

/**
 * @returns {string}
 */
exports.getDatPath = function () {
  return datPath
}

/**
 * @description Get the path to an archive's files.
 * @param {string | Buffer | DaemonDatArchive} archiveOrKey
 * @returns {string}
 */
//
const getArchiveMetaPath = exports.getArchiveMetaPath = function (archiveOrKey) {
  var key /** @type string */
  if (typeof archiveOrKey === 'string') {
    key = archiveOrKey
  } else if (Buffer.isBuffer(archiveOrKey)) {
    key = datEncoding.toStr(archiveOrKey)
  } else {
    key = datEncoding.toStr(archiveOrKey.key)
  }
  return path.join(datPath, 'Archives', 'Meta', key.slice(0, 2), key.slice(2))
}

/**
 * @description Delete all db entries and files for an archive.
 * @param {string} key
 * @returns {Promise<number>}
 */
exports.deleteArchive = async function (key) {
  const path = getArchiveMetaPath(key)
  const info = await jetpack.inspectTreeAsync(path)
  await Promise.all([
    db.run(`DELETE FROM archives WHERE key=?`, key),
    db.run(`DELETE FROM archives_meta WHERE key=?`, key),
    jetpack.removeAsync(path)
  ])
  return info ? info.size : 0
}

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description Upsert the last-access time.
 * @param {string | Buffer} key
 * @param {string} [timeVar]
 * @param {number} [value]
 * @returns {Promise<void>}
 */
exports.touch = async function (key, timeVar = 'lastAccessTime', value = -1) {
  var release = await lock('archives-db:meta')
  try {
    if (timeVar !== 'lastAccessTime' && timeVar !== 'lastLibraryAccessTime') {
      timeVar = 'lastAccessTime'
    }
    if (value === -1) value = Date.now()
    var keyStr = datEncoding.toStr(key)
    await db.run(`UPDATE archives_meta SET ${timeVar}=? WHERE key=?`, [value, keyStr])
    await db.run(`INSERT OR IGNORE INTO archives_meta (key, ${timeVar}) VALUES (?, ?)`, [keyStr, value])
  } finally {
    release()
  }
}

/**
 * @param {string} key
 * @returns {Promise<boolean>}
 */
exports.hasMeta = async function (key) {
  // massage inputs
  var keyStr = typeof key !== 'string' ? datEncoding.toStr(key) : key
  if (!DAT_HASH_REGEX.test(keyStr)) {
    try {
      keyStr = await require('../dat/dns').resolveName(keyStr)
    } catch (e) {
      return false
    }
  }

  // fetch
  var meta = await db.get(`
    SELECT
        archives_meta.key
      FROM archives_meta
      WHERE archives_meta.key = ?
  `, [keyStr])
  return !!meta
}

/**
 * @description
 * Get a single archive's metadata.
 * Returns an empty object on not-found.
 * @param {string | Buffer} key
 * @param {Object} [opts]
 * @param {boolean} [opts.noDefault]
 * @returns {Promise<LibraryArchiveMeta>}
 */
const getMeta = exports.getMeta = async function (key, {noDefault} = {noDefault: false}) {
  // massage inputs
  var keyStr = typeof key !== 'string' ? datEncoding.toStr(key) : key
  var origKeyStr = keyStr

  // validate inputs
  if (!DAT_HASH_REGEX.test(keyStr)) {
    try {
      keyStr = await require('../dat/dns').resolveName(keyStr)
    } catch (e) {
      return noDefault ? undefined : defaultMeta(keyStr, origKeyStr)
    }
  }

  // fetch
  var meta = await db.get(`
    SELECT
        archives_meta.*,
        dat_dns.name as dnsName
      FROM archives_meta
      LEFT JOIN dat_dns ON dat_dns.key = archives_meta.key AND dat_dns.isCurrent = 1
      WHERE archives_meta.key = ?
      GROUP BY archives_meta.key
  `, [keyStr])
  if (!meta) {
    return noDefault ? undefined : defaultMeta(keyStr, origKeyStr)
  }

  // massage some values
  meta.url = `dat://${meta.dnsName || meta.key}`
  meta.isOwner = !!meta.isOwner
  delete meta.dnsName

  // remove old attrs
  delete meta.createdByTitle
  delete meta.createdByUrl
  delete meta.metaSize
  delete meta.stagingSize
  delete meta.stagingSizeLessIgnored

  return meta
}

/**
 * @description Write an archive's metadata.
 * @param {string | Buffer} key
 * @param {LibraryArchiveMeta} [value]
 * @returns {Promise<void>}
 */
exports.setMeta = async function (key, value) {
  // massage inputs
  var keyStr = datEncoding.toStr(key)

  // validate inputs
  if (!DAT_HASH_REGEX.test(keyStr)) {
    throw new InvalidArchiveKeyError()
  }
  if (!value || typeof value !== 'object') {
    return // dont bother
  }

  // extract the desired values
  var {title, description, type, size, author, forkOf, mtime, isOwner} = value
  title = typeof title === 'string' ? title : ''
  description = typeof description === 'string' ? description : ''
  type = typeof type === 'string' ? type : ''
  var isOwnerFlag = flag(isOwner)
  if (typeof author === 'string') author = normalizeDatUrl(author)
  if (typeof forkOf === 'string') forkOf = normalizeDatUrl(forkOf)

  // write
  var release = await lock('archives-db:meta')
  var {lastAccessTime, lastLibraryAccessTime} = await getMeta(keyStr)
  try {
    await db.run(`
      INSERT OR REPLACE INTO
        archives_meta (key, title, description, type, mtime, size, author, forkOf, isOwner, lastAccessTime, lastLibraryAccessTime)
        VALUES        (?,   ?,     ?,           ?,    ?,     ?,    ?,      ?,      ?,       ?,              ?)
    `, [keyStr, title, description, type, mtime, size, author, forkOf, isOwnerFlag, lastAccessTime, lastLibraryAccessTime])
  } finally {
    release()
  }
  events.emit('update:archive-meta', keyStr, value)
}

// internal methods
// =

/**
 * @param {string} key
 * @param {string} name
 * @returns {LibraryArchiveMeta}
 */
function defaultMeta (key, name) {
  return {
    key,
    url: `dat://${name}`,
    title: undefined,
    description: undefined,
    type: undefined,
    author: undefined,
    forkOf: undefined,
    mtime: 0,
    isOwner: false,
    lastAccessTime: 0,
    lastLibraryAccessTime: 0,
    size: 0
  }
}

/**
 * @param {boolean} b
 * @returns {number}
 */
function flag (b) {
  return b ? 1 : 0
}

/**
 * @param {string} originURL
 * @returns {string}
 */
exports.extractOrigin = function (originURL) {
  var urlp = url.parse(originURL)
  if (!urlp || !urlp.host || !urlp.protocol) return
  return (urlp.protocol + (urlp.slashes ? '//' : '') + urlp.host)
}

function normalizeDatUrl (url) {
  var match = url.match(DAT_HASH_REGEX)
  if (match) {
    return `dat://${match[0]}`
  }
  return exports.extractOrigin(url)
}