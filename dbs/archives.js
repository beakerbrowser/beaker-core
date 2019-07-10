const path = require('path')
const url = require('url')
const mkdirp = require('mkdirp')
const Events = require('events')
const datEncoding = require('dat-encoding')
const jetpack = require('fs-jetpack')
const {InvalidArchiveKeyError} = require('beaker-error-constants')
const db = require('./profile-data-db')
const lock = require('../lib/lock')
const {
  DAT_HASH_REGEX,
  DAT_GC_EXPIRATION_AGE
} = require('../lib/const')

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 *
 * @typedef {Object} LibraryArchiveRecord
 * @prop {string} key
 * @prop {string} url
 * @prop {string?} domain
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<string>} type
 * @prop {number} mtime
 * @prop {number} size
 * @prop {boolean} isOwner
 * @prop {number} lastAccessTime
 * @prop {number} lastLibraryAccessTime
 * @prop {Object} userSettings
 * @prop {boolean} userSettings.isSaved
 * @prop {boolean} userSettings.hidden
 * @prop {boolean} userSettings.networked
 * @prop {boolean} userSettings.autoDownload
 * @prop {boolean} userSettings.autoUpload
 * @prop {number} userSettings.expiresAt
 * @prop {string} userSettings.localSyncPath
 * @prop {boolean} userSettings.previewMode
 *
 * @typedef {Object} LibraryArchiveMeta
 * @prop {string} key
 * @prop {string} title
 * @prop {string} description
 * @prop {string | Array<string>} type
 * @prop {Array<string>} installedNames
 * @prop {number} mtime
 * @prop {number} size
 * @prop {boolean} isOwner
 * @prop {number} lastAccessTime
 * @prop {number} lastLibraryAccessTime
 *
 * @typedef {Object} LibraryArchiveUserSettings
 * @prop {number} profileId
 * @prop {string} key
 * @prop {boolean} isSaved
 * @prop {boolean} hidden
 * @prop {boolean} networked
 * @prop {boolean} autoDownload
 * @prop {boolean} autoUpload
 * @prop {number} expiresAt
 * @prop {string} localSyncPath
 * @prop {boolean} previewMode
 * @prop {number} createdAt
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
 * @description Get the path to an archive's temporary local sync path.
 * @param {string | Buffer | DaemonDatArchive} archiveOrKey
 * @returns {string}
 */
const getInternalLocalSyncPath = exports.getInternalLocalSyncPath = function (archiveOrKey) {
  var key /** @type string */
  if (typeof archiveOrKey === 'string') {
    key = archiveOrKey
  } else if (Buffer.isBuffer(archiveOrKey)) {
    key = datEncoding.toStr(archiveOrKey)
  } else {
    key = datEncoding.toStr(archiveOrKey.key)
  }
  return path.join(datPath, 'Archives', 'LocalCopy', key.slice(0, 2), key.slice(2))
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
    db.run(`DELETE FROM archives_meta_type WHERE key=?`, key),
    jetpack.removeAsync(path),
    jetpack.removeAsync(getInternalLocalSyncPath(key))
  ])
  return info ? info.size : 0
}

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

// exported methods: archive user settings
// =

/**
 * @description Get an array of saved archives.
 * @param {number} profileId
 * @param {Object} [query]
 * @param {string} [query.key]
 * @param {boolean} [query.isSaved]
 * @param {boolean} [query.isNetworked]
 * @param {boolean} [query.isOwner]
 * @param {boolean} [query.showHidden]
 * @param {string} [query.type]
 * @param {string} [query.string]
 * @returns {Promise<LibraryArchiveRecord|Array<LibraryArchiveRecord>>}
 */
exports.query = async function (profileId, query = {}) {
  // fetch archive meta
  var values = []
  var whereList = []
  if (query.isOwner === true) whereList.push('archives_meta.isOwner = 1')
  if (query.isOwner === false) whereList.push('archives_meta.isOwner = 0')
  if (query.isNetworked === true) whereList.push('archives.networked = 1')
  if (query.isNetworked === false) whereList.push('archives.networked = 0')
  if ('isSaved' in query) {
    if (query.isSaved) {
      whereList.push('archives.profileId = ?')
      values.push(profileId)
      whereList.push('archives.isSaved = 1')
    } else {
      whereList.push('(archives.isSaved = 0 OR archives.isSaved IS NULL)')
    }
  }
  if (typeof query.key !== 'undefined') {
    whereList.push('archives_meta.key = ?')
    values.push(query.key)
  }
  if (!query.showHidden) whereList.push('(archives.hidden = 0 OR archives.hidden IS NULL)')
  var WHERE = whereList.length ? `WHERE ${whereList.join(' AND ')}` : ''

  var archives = await db.all(`
    SELECT
        archives_meta.*,
        GROUP_CONCAT(archives_meta_type.type) AS type,
        archives.isSaved,
        archives.hidden,
        archives.networked,
        archives.autoDownload,
        archives.autoUpload,
        archives.expiresAt,
        archives.localSyncPath,
        archives.previewMode,
        dat_dns.name as domain
      FROM archives_meta
      LEFT JOIN archives ON archives.key = archives_meta.key
      LEFT JOIN archives_meta_type ON archives_meta_type.key = archives_meta.key
      LEFT JOIN dat_dns ON dat_dns.key = archives_meta.key AND dat_dns.isCurrent = 1
      ${WHERE}
      GROUP BY archives_meta.key
  `, values)

  // massage the output
  archives.forEach(archive => {
    archive.url = `dat://${archive.domain || archive.key}`
    archive.isOwner = archive.isOwner != 0
    archive.type = archive.type ? archive.type.split(',') : []
    archive.userSettings = {
      isSaved: archive.isSaved == 1,
      hidden: archive.hidden == 0,
      networked: archive.networked == 1,
      autoDownload: archive.autoDownload == 1,
      autoUpload: archive.autoUpload == 1,
      expiresAt: archive.expiresAt,
      localSyncPath: archive.localSyncPath,
      previewMode: archive.previewMode == 1
    }

    // user settings
    delete archive.isSaved
    delete archive.hidden
    delete archive.networked
    delete archive.autoDownload
    delete archive.autoUpload
    delete archive.expiresAt
    delete archive.localSyncPath
    delete archive.previewMode

    // deprecated attrs
    delete archive.createdByTitle
    delete archive.createdByUrl
    delete archive.forkOf
    delete archive.metaSize
    delete archive.stagingSize
    delete archive.stagingSizeLessIgnored
  })

  // apply manual filters
  if ('type' in query) {
    let types = Array.isArray(query.type) ? query.type : [query.type]
    archives = archives.filter((/** @type LibraryArchiveRecord */ a) => {
      for (let type of types) {
        if (a.type.indexOf(type) === -1) {
          return false
        }
      }
      return true
    })
  }

  return ('key' in query) ? archives[0] : archives
}

/**
 * @description Get all archives that should be unsaved.
 * @returns {Promise<Array<MinimalLibraryArchiveRecord>>}
 */
exports.listExpiredArchives = async function () {
  return db.all(`
    SELECT archives.key
      FROM archives
      WHERE
        archives.isSaved = 1
        AND archives.expiresAt != 0
        AND archives.expiresAt IS NOT NULL
        AND archives.expiresAt < ?
  `, [Date.now()])
}

/**
 * @description Get all archives that are ready for garbage collection.
 * @param {Object} [opts]
 * @param {number} [opts.olderThan]
 * @param {boolean} [opts.isOwner]
 * @returns {Promise<Array<MinimalLibraryArchiveRecord>>}
 */
exports.listGarbageCollectableArchives = async function ({olderThan, isOwner} = {}) {
  olderThan = typeof olderThan === 'number' ? olderThan : DAT_GC_EXPIRATION_AGE
  var isOwnerClause = typeof isOwner === 'boolean' ? `AND archives_meta.isOwner = ${isOwner ? '1' : '0'}` : ''

  // fetch archives
  var records = await db.all(`
    SELECT archives_meta.key
      FROM archives_meta
      LEFT JOIN archives ON archives_meta.key = archives.key
      WHERE
        (archives.isSaved != 1 OR archives.isSaved IS NULL)
        AND archives_meta.lastAccessTime < ?
        ${isOwnerClause}
  `, [Date.now() - olderThan])
  var records2 = records.slice()

  // fetch any related drafts
  for (let record of records2) {
    let drafts = await db.all(`SELECT draftKey as key FROM archive_drafts WHERE masterKey = ? ORDER BY createdAt`, [record.key])
    records = records.concat(drafts)
  }

  return records
}

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
 * @description
 * Get a single archive's user settings.
 * (Returns an empty object on not found.)
 * @param {number} profileId
 * @param {string | Buffer} key
 * @returns {Promise<LibraryArchiveUserSettings>}
 */
const getUserSettings = exports.getUserSettings = async function (profileId, key) {
  // massage inputs
  var keyStr = typeof key !== 'string' ? datEncoding.toStr(key) : key

  // validate inputs
  if (!DAT_HASH_REGEX.test(keyStr)) {
    throw new InvalidArchiveKeyError()
  }

  // fetch
  try {
    var settings = await db.get(`
      SELECT * FROM archives WHERE profileId = ? AND key = ?
    `, [profileId, keyStr])
    settings.isSaved = !!settings.isSaved
    settings.hidden = !!settings.hidden
    settings.networked = !!settings.networked
    settings.autoDownload = !!settings.autoDownload
    settings.autoUpload = !!settings.autoUpload
    settings.previewMode = Number(settings.previewMode) === 1
    return /** @type LibraryArchiveUserSettings */(settings)
  } catch (e) {
    return /** @type LibraryArchiveUserSettings */({})
  }
}

/**
 * @description Write an archive's user setting.
 * @param {number} profileId
 * @param {string | Buffer} key
 * @param {Object} [newValues]
 * @param {boolean} [newValues.isSaved]
 * @param {boolean} [newValues.hidden]
 * @param {boolean} [newValues.networked]
 * @param {boolean} [newValues.autoDownload]
 * @param {boolean} [newValues.autoUpload]
 * @param {number} [newValues.expiresAt]
 * @param {string} [newValues.localSyncPath]
 * @param {boolean} [newValues.previewMode]
 * @returns {Promise<LibraryArchiveUserSettings>}
 */
exports.setUserSettings = async function (profileId, key, newValues = {}) {
  // massage inputs
  var keyStr = datEncoding.toStr(key)

  // validate inputs
  if (!DAT_HASH_REGEX.test(keyStr)) {
    throw new InvalidArchiveKeyError()
  }

  var release = await lock('archives-db')
  try {
    // fetch current
    var value = await getUserSettings(profileId, keyStr)

    if (!value || typeof value.key === 'undefined') {
      // create
      value = /** @type LibraryArchiveUserSettings */ ({
        profileId,
        key: keyStr,
        isSaved: newValues.isSaved,
        hidden: newValues.hidden,
        networked: ('networked' in newValues) ? newValues.networked : true,
        autoDownload: ('autoDownload' in newValues) ? newValues.autoDownload : newValues.isSaved,
        autoUpload: ('autoUpload' in newValues) ? newValues.autoUpload : newValues.isSaved,
        expiresAt: newValues.expiresAt,
        localSyncPath: (newValues.localSyncPath) ? newValues.localSyncPath : '',
        previewMode: ('previewMode' in newValues) ? newValues.previewMode : ''
      })
      let valueArray = [
        profileId,
        keyStr,
        flag(value.isSaved),
        flag(value.hidden),
        flag(value.networked),
        flag(value.autoDownload),
        flag(value.autoUpload),
        value.expiresAt,
        value.localSyncPath,
        flag(value.previewMode)
      ]
      await db.run(`
        INSERT INTO archives
          (
            profileId,
            key,
            isSaved,
            hidden,
            networked,
            autoDownload,
            autoUpload,
            expiresAt,
            localSyncPath,
            previewMode
          )
          VALUES (${valueArray.map(_ => '?').join(', ')})
      `, valueArray)
    } else {
      // update
      let { isSaved, hidden, networked, autoDownload, autoUpload, expiresAt, localSyncPath, previewMode } = newValues
      if (typeof isSaved === 'boolean') value.isSaved = isSaved
      if (typeof hidden === 'boolean') value.hidden = hidden
      if (typeof networked === 'boolean') value.networked = networked
      if (typeof autoDownload === 'boolean') value.autoDownload = autoDownload
      if (typeof autoUpload === 'boolean') value.autoUpload = autoUpload
      if (typeof expiresAt === 'number') value.expiresAt = expiresAt
      if (typeof localSyncPath === 'string') value.localSyncPath = localSyncPath
      if (typeof previewMode === 'boolean') value.previewMode = previewMode
      let valueArray = [
        flag(value.isSaved),
        flag(value.hidden),
        flag(value.networked),
        flag(value.autoDownload),
        flag(value.autoUpload),
        value.expiresAt,
        value.localSyncPath,
        flag(value.previewMode),
        profileId,
        keyStr
      ]
      await db.run(`
        UPDATE archives
          SET
            isSaved = ?,
            hidden = ?,
            networked = ?,
            autoDownload = ?,
            autoUpload = ?,
            expiresAt = ?,
            localSyncPath = ?,
            previewMode = ?
          WHERE
            profileId = ? AND key = ?
      `, valueArray)
    }

    events.emit('update:archive-user-settings', keyStr, value, newValues)
    return value
  } finally {
    release()
  }
}

// exported methods: archive meta
// =

/**
 * @description
 * Get a single archive's metadata.
 * Returns an empty object on not-found.
 * @param {string | Buffer} key
 * @returns {Promise<LibraryArchiveMeta>}
 */
const getMeta = exports.getMeta = async function (key) {
  // massage inputs
  var keyStr = typeof key !== 'string' ? datEncoding.toStr(key) : key

  // validate inputs
  if (!DAT_HASH_REGEX.test(keyStr)) {
    keyStr = await require('../dat/dns').resolveName(keyStr)
  }

  // fetch
  var meta = await db.get(`
    SELECT
        archives_meta.*,
        GROUP_CONCAT(archives_meta_type.type) AS type,
        GROUP_CONCAT(apps.name) as installedNames
      FROM archives_meta
      LEFT JOIN archives_meta_type ON archives_meta_type.key = archives_meta.key
      LEFT JOIN apps ON apps.url = ('dat://' || archives_meta.key)
      WHERE archives_meta.key = ?
      GROUP BY archives_meta.key
  `, [keyStr])
  if (!meta) {
    return defaultMeta(keyStr)
  }

  // massage some values
  meta.isOwner = !!meta.isOwner
  meta.type = meta.type ? meta.type.split(',') : []
  meta.installedNames = meta.installedNames ? meta.installedNames.split(',') : []

  // remove old attrs
  delete meta.createdByTitle
  delete meta.createdByUrl
  delete meta.forkOf
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
  var {title, description, type, size, mtime, isOwner} = value
  title = typeof title === 'string' ? title : ''
  description = typeof description === 'string' ? description : ''
  if (typeof type === 'string') type = type.split(' ')
  else if (Array.isArray(type)) type = type.filter(v => v && typeof v === 'string')
  var isOwnerFlag = flag(isOwner)

  // write
  var release = await lock('archives-db:meta')
  var {lastAccessTime, lastLibraryAccessTime} = await getMeta(keyStr)
  try {
    await db.run(`
      INSERT OR REPLACE INTO
        archives_meta (key, title, description, mtime, size, isOwner, lastAccessTime, lastLibraryAccessTime)
        VALUES        (?,   ?,     ?,           ?,     ?,    ?,       ?,              ?)
    `, [keyStr, title, description, mtime, size, isOwnerFlag, lastAccessTime, lastLibraryAccessTime])
    await db.run(`DELETE FROM archives_meta_type WHERE key=?`, keyStr)
    if (type) {
      await Promise.all(type.map(t => (
        db.run(`INSERT INTO archives_meta_type (key, type) VALUES (?, ?)`, [keyStr, t])
      )))
    }
  } finally {
    release()
  }
  events.emit('update:archive-meta', keyStr, value)
}

/**
 * @description Find the archive currently using a given localSyncPath.
 * @param {number} profileId
 * @param {string} localSyncPath
 * @returns {Promise<MinimalLibraryArchiveRecord | null>}
 */
exports.getByLocalSyncPath = async function (profileId, localSyncPath) {
  try {
    return await db.get(`
      SELECT key FROM archives WHERE profileId = ? AND localSyncPath = ?
    `, [profileId, localSyncPath])
  } catch (e) {
    return null
  }
}

// internal methods
// =

/**
 * @param {string} key
 * @returns {LibraryArchiveMeta}
 */
function defaultMeta (key) {
  return {
    key,
    title: null,
    description: null,
    type: [],
    mtime: 0,
    isOwner: false,
    lastAccessTime: 0,
    lastLibraryAccessTime: 0,
    installedNames: [],
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
