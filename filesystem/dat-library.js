const logger = require('../logger').child({category: 'filesystem', subcategory: 'dat-library'})
const filesystem = require('./index')
const trash = require('./trash')
const archivesDb = require('../dbs/archives')
const datArchives = require('../dat/archives')
const lock = require('../lib/lock')
const users = require('./users')
const joinPath = require('path').join
const slugify = require('slugify')
const libTools = require('@beaker/library-tools')
const libraryJsonSchema = require('@beaker/library-tools/library.json')
const {PATHS, DAT_HASH_REGEX} = require('../lib/const')

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 * @typedef {import('./users').User} User
 * @typedef {import('../dbs/archives').LibraryArchiveMeta} LibraryArchiveMeta
 *
 * @typedef {Object} LibraryDat
 * @prop {string} key
 * @prop {boolean} isSaved
 * @prop {boolean} isHosting
 * @prop {string} visibility
 * @prop {Date} savedAt
 * @prop {LibraryArchiveMeta} meta
 */

// globals
// =

var libraryDats = /** @type LibraryDat[] */([])

// exported api
// =

/**
 * @returns {Promise<void>}
 */
exports.setup = async function () {
  // read library.json
  var libraryJsonStr
  try {
    libraryJsonStr = await filesystem.get().pda.readFile(PATHS.LIBRARY_JSON)
  } catch (e) {
    // dne
  }

  // parse & validate
  var dats = []
  if (libraryJsonStr) {
    try {
      let libraryJsonObj = JSON.parse(libraryJsonStr)
      dats = (libraryJsonObj.dats || []).filter(dat => typeof dat.key === 'string' && DAT_HASH_REGEX.test(dat.key))
    } catch (e) {
      logger.error(`Invalid ${PATHS.LIBRARY_JSON} file`, {error: e})
      logger.error(`A new ${PATHS.LIBRARY_JSON} will be created and the previous file will be saved as ${PATHS.LIBRARY_JSON}.backup`)
      await filesystem.get().pda.rename(PATHS.LIBRARY_JSON, PATHS.LIBRARY_JSON + '.backup')
    }
  }

  // massage and fetch additional info
  for (let dat of dats) {
    dat.isSaved = true
    dat.savedAt = new Date(dat.savedAt)
    dat.meta = await archivesDb.getMeta(dat.key)
  }
  libraryDats = dats

  // watch for updates to library dats
  datArchives.on('updated', async ({key, details, oldMeta}) => {
    var dat = libraryDats.find(dat => dat.key === key)
    if (!dat) return

    var release = await lock(`configure-archive:${key}`)
    try {
      // update the record
      dat.meta = await archivesDb.getMeta(key)

      // handle state changes
      var oldCat = libTools.typeToCategory(oldMeta.type, true)
      var newCat = libTools.typeToCategory(details.type, true)
      var changes = {
        type: newCat !== oldCat,
        title: details.title !== oldMeta.title,
        author: details.author !== oldMeta.author
      }
      if (changes.type || changes.title) {
        let archive = await datArchives.getOrLoadArchive(key)
        await ensureUnmounted(filesystem.get(), PATHS.LIBRARY_SAVED_DAT(oldCat), archive)
        await ensureMounted(filesystem.get(), PATHS.LIBRARY_SAVED_DAT(newCat), archive, details.title)
      }
      if (dat.visibility === 'public' && (changes.author || changes.title)) {
        let oldUser = oldMeta.author ? await users.get(oldMeta.author) : null
        let newUser = details.author ? await users.get(details.author) : null
        let archive = await datArchives.getOrLoadArchive(key)
        if (oldUser) await ensureUnmounted(oldUser.archive, PATHS.REFS_AUTHORED_DATS, archive)
        if (newUser) await ensureMounted(newUser.archive, PATHS.REFS_AUTHORED_DATS, archive, details.title)
      }
    } catch (e) {
      logger.error('Failed to update archive in filesystem after change', {error: e, key, details, oldMeta})
    } finally {
      release()
    }
  })
}

/**
 * @param {Object} query
 * @param {string} [query.type]
 * @param {string} [query.forkOf]
 * @param {boolean} [query.isSaved]
 * @param {boolean} [query.isHosting]
 * @param {boolean} [query.isOwner]
 * @returns {LibraryDat[]}
 */
exports.query = function (query = {}) {
  // TODO handle query.isSaved === false
  var results = []
  for (let dat of libraryDats) {
    let isMatch = true
    if ('type' in query) {
      let types = Array.isArray(query.type) ? query.type : [query.type]
      for (let type of types) {
        if (dat.meta.type.indexOf(type) === -1) {
          isMatch = false
          break
        }
      }
    }
    if ('forkOf' in query) {
      if (dat.meta.forkOf !== query.forkOf) {
        isMatch = false
      }
    }
    if ('isHosting' in query) {
      if (dat.isHosting !== query.isHosting) {
        isMatch = false
      }
    }
    if ('isOwner' in query) {
      if (dat.meta.isOwner !== query.isOwner) {
        isMatch = false
      }
    }
    if (isMatch) {
      let result = /** @type LibraryDat */({
        key: dat.key,
        meta: Object.assign({}, dat.meta),
        isSaved: true,
        isHosting: dat.isHosting,
        visibility: dat.visibility,
        savedAt: new Date(dat.savedAt)
      })
      results.push(result)
    }
  }
  return results
}

/**
 * @returns {Promise<LibraryDat[]>}
 */
exports.listTrashed = async function () {
  var items = await trash.query({mounts: true})
  return Promise.all(items.map(async (item) => ({
    key: item.stat.mount.key,
    meta: await archivesDb.getMeta(item.stat.mount.key),
    isSaved: false,
    isHosting: false,
    visibility: undefined,
    savedAt: item.stat.mtime
  })))
}

/**
 * @param {string} key
 * @returns {LibraryDat?}
 */
exports.getConfig = function (key) {
  var dat = libraryDats.find(dat => dat.key === key)
  if (dat) {
    return /** @type LibraryDat */({
      key,
      meta: Object.assign({}, dat.meta),
      isSaved: dat.isSaved,
      isHosting: dat.isHosting,
      visibility: dat.visibility,
      savedAt: new Date(dat.savedAt)
    })
  }
  return null
}

/**
 * @param {DaemonDatArchive} archive
 * @param {Object} settings
 * @param {boolean} [settings.isSaved]
 * @param {boolean} [settings.isHosting]
 * @param {string} [settings.visibility]
 * @returns {Promise<void>}
 */
exports.configureArchive = async function (archive, settings) {
  var key = archive.key.toString('hex')
  var release = await lock(`configure-archive:${key}`)
  try {
    // fetch existing record (if it exists)
    var record = libraryDats.find(r => r.key === key)
    if (!('isSaved' in settings)) {
      settings.isSaved = !!record
    }

    // grab old values
    var oldSettings = {
      isSaved: !!record,
      isHosting: record ? record.isHosting : false,
      visibility: record ? record.visibility : 'unlisted'
    }

    if (settings.isSaved && !record) {
      // add
      let meta = await archivesDb.getMeta(key)
      record = {key, meta, isSaved: true, isHosting: false, visibility: 'unlisted', savedAt: new Date()}
      libraryDats.push(record)
    } else if (!settings.isSaved && record) {
      // remove
      libraryDats = libraryDats.filter(r => r !== record)
      settings.isHosting = false
      settings.visibility = 'unlisted'
    }

    // update
    if ('isHosting' in settings) record.isHosting = settings.isHosting
    if ('visibility' in settings) record.visibility = settings.visibility

    // persist
    await saveLibraryJson()

    // handle state changes
    var manifest = await archive.pda.readManifest().catch(e => {})
    if ('visibility' in settings && oldSettings.visibility !== settings.visibility) {
      await updateVisibility(archive, manifest, settings.visibility)
    }
    if ('isHosting' in settings && oldSettings.isHosting !== settings.isHosting) {
      await updateHosting(archive, manifest, settings.isHosting)
    }
    if (settings.isSaved !== oldSettings.isSaved) {
      await updateSaved(archive, manifest, settings.isSaved)
    }
  } finally {
    release()
  }
}

// internal methods
// =

/**
 * @returns {Promise<void>}
 */
async function saveLibraryJson () {
  await filesystem.get().pda.writeFile(PATHS.LIBRARY_JSON, JSON.stringify({
    type: 'beakerbrowser.com/library',
    dats: libraryDats.map(dat => ({
      key: dat.key,
      isHosting: dat.isHosting,
      visibility: dat.visibility,
      savedAt: dat.savedAt.toISOString()
    }))
  }))
}

/**
 * @param {DaemonDatArchive} archive
 * @param {Object} manifest
 * @param {boolean} isSaved
 * @returns {Promise<void>}
 */
async function updateSaved (archive, manifest, isSaved) {
  var category = libTools.typeToCategory(manifest.type, true)
  var containingPath = PATHS.LIBRARY_SAVED_DAT(category)
  if (isSaved) {
    await ensureMounted(filesystem.get(), containingPath, archive, manifest.title)
    await ensureUnmounted(filesystem.get(), PATHS.TRASH, archive)
  } else {
    await ensureMounted(filesystem.get(), PATHS.TRASH, archive, manifest.title)
    await ensureUnmounted(filesystem.get(), containingPath, archive)
  }
}

/**
 * @param {DaemonDatArchive} archive
 * @param {Object} manifest
 * @param {Boolean} isHosting
 * @returns {Promise<void>}
 */
async function updateHosting (archive, manifest, isHosting) {
  // TODO
}

/**
 * @param {DaemonDatArchive} archive
 * @param {Object} manifest
 * @param {string} visibility
 * @returns {Promise<void>}
 */
async function updateVisibility (archive, manifest, visibility) {
  var user = await users.get(manifest.author)
  if (!user) {
    logger.error(`Failed to ${visibility === 'public' ? 'publish' : 'unpublish'} archive, author-user not found`, {
      key: archive.key.toString('hex'),
      author: manifest.author
    })
    return
  }
  if (visibility === 'public') {
    await ensureMounted(user.archive, PATHS.REFS_AUTHORED_DATS, archive, manifest.title)
  } else {
    await ensureUnmounted(user.archive, PATHS.REFS_AUTHORED_DATS, archive)
  }
}

/**
 * @param {DaemonDatArchive} containingArchive
 * @param {string} containingPath
 * @param {DaemonDatArchive} archive
 * @returns {Promise<string?>}
 */
async function findMount (containingArchive, containingPath, archive) {
  var names = await containingArchive.pda.readdir(containingPath)
  for (let name of names) {
    try {
      let st = await containingArchive.pda.stat(joinPath(containingPath, name))
      if (st.mount && Buffer.compare(st.mount.key, archive.key) === 0) {
        return name
      }
    } catch (e) {
      logger.error('Stat() failed during findMount()', {name, error: e})
      // ignore, it's possible the file was removed after readdir()
    }
  }
  return undefined
}

/**
 * @param {DaemonDatArchive} containingArchive
 * @param {string} containingPath
 * @param {string} title
 * @returns {Promise<string>}
 */
async function getAvailableMountName (containingArchive, containingPath, title) {
  var basename = slugify((title || '').trim() || 'untitled').toLowerCase()
  for (let i = 1; i < 1e9; i++) {
    let name = (i === 1) ? basename : `${basename}-${i}`
    try {
      await containingArchive.pda.stat(joinPath(containingPath, name))
      // file already exists, skip
    } catch (e) {
      // dne, this works
      return name
    }
  }
  // yikes if this happens
  throw new Error('Unable to find an available name for ' + title)
}

/**
 * @param {DaemonDatArchive} containingArchive
 * @param {string} containingPath
 * @param {DaemonDatArchive} archive
 * @param {string} title
 * @returns {Promise<void>}
 */
async function ensureMounted (containingArchive, containingPath, archive, title) {
  try {
    if (!(await findMount(containingArchive, containingPath, archive))) {
      var mountName = await getAvailableMountName(containingArchive, containingPath, title)
      await containingArchive.pda.mount(joinPath(containingPath, mountName), archive.key)
    }
  } catch (e) {
    logger.error('Failed to mount archive', {key: archive.key.toString('hex'), error: e})
  }
}

/**
 * @param {DaemonDatArchive} containingArchive
 * @param {string} containingPath
 * @param {DaemonDatArchive} archive
 * @returns {Promise<void>}
 */
async function ensureUnmounted (containingArchive, containingPath, archive) {
  try {
    var mountName = await findMount(containingArchive, containingPath, archive)
    if (mountName) {
      await containingArchive.pda.unmount(joinPath(containingPath, mountName))
    }
  } catch (e) {
    logger.error('Failed to unmount archive', {key: archive.key.toString('hex'), error: e})
  }
}