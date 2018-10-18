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

// globals
// =

var datPath // path to the dat folder
var events = new Events()

// exported methods
// =

exports.setup = function (opts) {
  // make sure the folders exist
  datPath = path.join(opts.userDataPath, 'Dat')
  mkdirp.sync(path.join(datPath, 'Archives'))
}

// get the path to an archive's files
const getArchiveMetaPath = exports.getArchiveMetaPath = function (archiveOrKey) {
  var key = datEncoding.toStr(archiveOrKey.key || archiveOrKey)
  return path.join(datPath, 'Archives', 'Meta', key.slice(0, 2), key.slice(2))
}

// get the path to an archive's temporary local sync path
const getInternalLocalSyncPath = exports.getInternalLocalSyncPath = function (archiveOrKey) {
  var key = datEncoding.toStr(archiveOrKey.key || archiveOrKey)
  return path.join(datPath, 'Archives', 'LocalCopy', key.slice(0, 2), key.slice(2))
}

// delete all db entries and files for an archive
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
  return info.size
}

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

// exported methods: archive user settings
// =

// get an array of saved archives
// - optional `query` keys:
//   - `isSaved`: bool
//   - `isNetworked`: bool
//   - `isOwner`: bool, does beaker have the secret key?
//   - `type`: string, a type filter
//   - `showHidden`: bool, show hidden dats
//   - `key`: string, the key of the archive you want (return single result)
exports.query = async function (profileId, query) {
  query = query || {}

  // fetch archive meta
  var values = []
  var WHERE = []
  if (query.isOwner === true) WHERE.push('archives_meta.isOwner = 1')
  if (query.isOwner === false) WHERE.push('archives_meta.isOwner = 0')
  if (query.isNetworked === true) WHERE.push('archives.networked = 1')
  if (query.isNetworked === false) WHERE.push('archives.networked = 0')
  if ('isSaved' in query) {
    if (query.isSaved) {
      WHERE.push('archives.profileId = ?')
      values.push(profileId)
      WHERE.push('archives.isSaved = 1')
    } else {
      WHERE.push('(archives.isSaved = 0 OR archives.isSaved IS NULL)')
    }
  }
  if ('key' in query) {
    WHERE.push('archives_meta.key = ?')
    values.push(query.key)
  }
  if (!query.showHidden) WHERE.push('(archives.hidden = 0 OR archives.hidden IS NULL)')
  if (WHERE.length) WHERE = `WHERE ${WHERE.join(' AND ')}`
  else WHERE = ''

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
        archives.previewMode
      FROM archives_meta
      LEFT JOIN archives ON archives.key = archives_meta.key
      LEFT JOIN archives_meta_type ON archives_meta_type.key = archives_meta.key
      ${WHERE}
      GROUP BY archives_meta.key
  `, values)

  // massage the output
  archives.forEach(archive => {
    archive.url = `dat://${archive.key}`
    archive.isOwner = archive.isOwner != 0
    archive.type = archive.type ? archive.type.split(',') : []
    archive.userSettings = {
      isSaved: archive.isSaved != 0,
      hidden: archive.hidden != 0,
      networked: archive.networked != 0,
      autoDownload: archive.autoDownload != 0,
      autoUpload: archive.autoUpload != 0,
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
    archives = archives.filter(a => {
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

// get all archives that should be unsaved
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

// get all archives that are ready for garbage collection
exports.listGarbageCollectableArchives = async function ({olderThan, isOwner} = {}) {
  olderThan = typeof olderThan === 'number' ? olderThan : DAT_GC_EXPIRATION_AGE
  isOwner = typeof isOwner === 'boolean' ? `AND archives_meta.isOwner = ${isOwner ? '1' : '0'}` : ''

  // fetch archives
  var records = await db.all(`
    SELECT archives_meta.key
      FROM archives_meta
      LEFT JOIN archives ON archives_meta.key = archives.key
      WHERE
        (archives.isSaved != 1 OR archives.isSaved IS NULL)
        AND archives_meta.lastAccessTime < ?
        ${isOwner}
  `, [Date.now() - olderThan])
  var records2 = records.slice()

  // fetch any related drafts
  for (let record of records2) {
    let drafts = await db.all(`SELECT draftKey as key FROM archive_drafts WHERE masterKey = ? ORDER BY createdAt`, [record.key])
    records = records.concat(drafts)
  }

  return records
}

// upsert the last-access time
exports.touch = async function (key, timeVar = 'lastAccessTime', value = -1) {
  var release = await lock('archives-db:meta')
  try {
    if (timeVar !== 'lastAccessTime' && timeVar !== 'lastLibraryAccessTime') {
      timeVar = 'lastAccessTime'
    }
    if (value === -1) value = Date.now()
    key = datEncoding.toStr(key)
    await db.run(`UPDATE archives_meta SET ${timeVar}=? WHERE key=?`, [value, key])
    await db.run(`INSERT OR IGNORE INTO archives_meta (key, ${timeVar}) VALUES (?, ?)`, [key, value])
  } finally {
    release()
  }
}

// get a single archive's user settings
// - supresses a not-found with an empty object
const getUserSettings = exports.getUserSettings = async function (profileId, key) {
  // massage inputs
  key = datEncoding.toStr(key)

  // validate inputs
  if (!DAT_HASH_REGEX.test(key)) {
    throw new InvalidArchiveKeyError()
  }

  // fetch
  try {
    var settings = await db.get(`
      SELECT * FROM archives WHERE profileId = ? AND key = ?
    `, [profileId, key])
    settings.isSaved = !!settings.isSaved
    settings.hidden = !!settings.hidden
    settings.networked = !!settings.networked
    settings.autoDownload = !!settings.autoDownload
    settings.autoUpload = !!settings.autoUpload
    settings.previewMode = settings.previewMode == 1
    return settings
  } catch (e) {
    return {}
  }
}

// write an archive's user setting
exports.setUserSettings = async function (profileId, key, newValues = {}) {
  // massage inputs
  key = datEncoding.toStr(key)

  // validate inputs
  if (!DAT_HASH_REGEX.test(key)) {
    throw new InvalidArchiveKeyError()
  }

  var release = await lock('archives-db')
  try {
    // fetch current
    var value = await getUserSettings(profileId, key)

    if (!value || typeof value.key === 'undefined') {
      // create
      value = {
        profileId,
        key,
        isSaved: newValues.isSaved,
        hidden: newValues.hidden,
        networked: ('networked' in newValues) ? newValues.networked : true,
        autoDownload: ('autoDownload' in newValues) ? newValues.autoDownload : newValues.isSaved,
        autoUpload: ('autoUpload' in newValues) ? newValues.autoUpload : newValues.isSaved,
        expiresAt: newValues.expiresAt,
        localSyncPath: ('localSyncPath' in newValues) ? newValues.localSyncPath : '',
        previewMode: ('previewMode' in newValues) ? newValues.previewMode : ''
      }
      let valueArray = [
        profileId,
        key,
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
        key
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

    events.emit('update:archive-user-settings', key, value, newValues)
    return value
  } finally {
    release()
  }
}

// exported methods: archive meta
// =

// get a single archive's metadata
// - supresses a not-found with an empty object
const getMeta = exports.getMeta = async function (key) {
  // massage inputs
  key = datEncoding.toStr(key)

  // validate inputs
  if (!DAT_HASH_REGEX.test(key)) {
    throw new InvalidArchiveKeyError()
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
  `, [key])
  if (!meta) {
    return defaultMeta(key)
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

// write an archive's metadata
exports.setMeta = async function (key, value = {}) {
  // massage inputs
  key = datEncoding.toStr(key)

  // validate inputs
  if (!DAT_HASH_REGEX.test(key)) {
    throw new InvalidArchiveKeyError()
  }

  // extract the desired values
  var {title, description, type, size, mtime, isOwner} = value
  title = typeof title === 'string' ? title : ''
  description = typeof description === 'string' ? description : ''
  if (typeof type === 'string') type = type.split(' ')
  else if (Array.isArray(type)) type = type.filter(v => v && typeof v === 'string')
  isOwner = flag(isOwner)

  // write
  var release = await lock('archives-db:meta')
  var {lastAccessTime, lastLibraryAccessTime} = await getMeta(key)
  try {
    await db.run(`
      INSERT OR REPLACE INTO
        archives_meta (key, title, description, mtime, size, isOwner, lastAccessTime, lastLibraryAccessTime)
        VALUES        (?,   ?,     ?,           ?,     ?,    ?,       ?,              ?)
    `, [key, title, description, mtime, size, isOwner, lastAccessTime, lastLibraryAccessTime])
    await db.run(`DELETE FROM archives_meta_type WHERE key=?`, key)
    if (type) {
      await Promise.all(type.map(t => (
        db.run(`INSERT INTO archives_meta_type (key, type) VALUES (?, ?)`, [key, t])
      )))
    }
  } finally {
    release()
  }
  events.emit('update:archive-meta', key, value)
}

// find the archive currently using a given localSyncPath
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

function defaultMeta (key) {
  return {
    key,
    title: null,
    description: null,
    type: [],
    author: null,
    mtime: 0,
    isOwner: false,
    lastAccessTime: 0,
    installedNames: []
  }
}

function flag (b) {
  return b ? 1 : 0
}

exports.extractOrigin = function (originURL) {
  var urlp = url.parse(originURL)
  if (!urlp || !urlp.host || !urlp.protocol) return
  return (urlp.protocol + (urlp.slashes ? '//' : '') + urlp.host)
}
