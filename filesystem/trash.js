const ms = require('ms')
const joinPath = require('path').join
const archivesDb = require('../dbs/archives')
const datArchives = require('../dat/archives')
const filesystem = require('./index')
const {DAT_CACHE_TIME} = require('../lib/const')
const {
  TRASH_PATH,
  TRASH_FIRST_COLLECT_WAIT,
  TRASH_REGULAR_COLLECT_WAIT,
  TRASH_EXPIRATION_AGE
} = require('./const')
const logger = require('../logger').child({category: 'filesystem', subcategory: 'trash-collector'})

// typedefs
// =

/**
 * @typedef {Object} CollectResult
 * @prop {number} totalBytes
 * @prop {number} totalItems
 *
 * @typedef {Object} TrashItem
 * @prop {string} name
 * @prop {Object} stat
 */

// globals
// =

var nextGCTimeout

// exported API
// =

exports.setup = function () {
  schedule(TRASH_FIRST_COLLECT_WAIT)
}

/**
 * @param {Object} [query]
 * @param {boolean} [query.mounts]
 * @param {number} [query.olderThan]
 * @returns {Promise<TrashItem[]>}
 */
exports.query = async function (query = {}) {
  var items = /** @type TrashItem[] */([])
  var names = await filesystem.get().pda.readdir(TRASH_PATH)
  for (let name of names) {
    let st = await filesystem.get().pda.stat(joinPath(TRASH_PATH, name))
    if (query.mounts && !st.mount) {
      continue
    }
    if (query.olderThan) {
      if (Date.now() - st.mtime < query.olderThan) {
        continue
      }
    }
    items.push({name, stat: st})
  }
  return items
}

/**
 * @param {Object} [opts]
 * @param {number} [opts.olderThan]
 * @returns {Promise<CollectResult>}
 */
const collect = exports.collect = async function ({olderThan} = {}) {
  logger.info('Running GC')
  olderThan = typeof olderThan === 'number' ? olderThan : TRASH_EXPIRATION_AGE

  // clear any scheduled GC
  if (nextGCTimeout) {
    clearTimeout(nextGCTimeout)
    nextGCTimeout = null
  }

  // run the GC
  var totalBytes = 0
  var startTime = Date.now()

  // clear items in trash
  var trashItems = await exports.query({olderThan})
  if (trashItems.length) {
    logger.info(`Deleting ${trashItems.length} items in trash`)
    logger.silly('Items:', {urls: trashItems.map(a => a.name)})
  }
  for (let item of trashItems) {
    let path = joinPath(TRASH_PATH, item.name)
    if (item.stat.mount) {
      await filesystem.get().pda.unmount(path)
    } else if (item.stat.isDirectory()) {
      await filesystem.get().pda.rmdir(path, {recursive: true})
    } else {
      await filesystem.get().pda.unlink(path)
    }
    totalBytes += item.stat.size
  }

  // clear cached dats
  // TODO
  // fetch all archive metas with lastaccesstime older than DAT_CACHE_TIME
  // then delete the archive
  {
    // await datLibrary.removeFromTrash(trashItems[i].key)
    // totalBytes += await archivesDb.deleteArchive(trashItems[i].key)
  }

  logger.debug(`GC completed in ${Date.now() - startTime} ms`)

  // schedule the next GC
  schedule(TRASH_REGULAR_COLLECT_WAIT)
  logger.debug(`Scheduling next run to happen in ${ms(TRASH_REGULAR_COLLECT_WAIT)}`)

  // return stats
  return {totalBytes, totalItems: trashItems.length}
}

// helpers
// =

/**
 * @param {number} time
 */
function schedule (time) {
  nextGCTimeout = setTimeout(collect, time)
  nextGCTimeout.unref()
}
