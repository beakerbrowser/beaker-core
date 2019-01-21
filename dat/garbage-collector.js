const ms = require('ms')
const archivesDb = require('../dbs/archives')
const datLibrary = require('./library')
const {
  DAT_GC_FIRST_COLLECT_WAIT,
  DAT_GC_REGULAR_COLLECT_WAIT
} = require('../lib/const')
const logger = require('../logger').child({category: 'dat', subcategory: 'garbage-collector'})

// typedefs
// =

/**
 * @typedef {Object} CollectResult
 * @prop {number} totalBytes
 * @prop {number} totalArchives
 * @prop {number} skippedArchives
 */

// globals
// =

var nextGCTimeout

// exported API
// =

exports.setup = function () {
  schedule(DAT_GC_FIRST_COLLECT_WAIT)
}

/**
 * @param {Object} [opts]
 * @param {number} [opts.olderThan]
 * @param {boolean} [opts.isOwner]
 * @returns {Promise<CollectResult>}
 */
const collect = exports.collect = async function ({olderThan, isOwner} = {}) {
  logger.info('Running GC')

  // clear any scheduled GC
  if (nextGCTimeout) {
    clearTimeout(nextGCTimeout)
    nextGCTimeout = null
  }

  // run the GC
  var totalBytes = 0
  var skippedArchives = 0
  var startTime = Date.now()

  // first unsave expired archives
  var expiredArchives = await archivesDb.listExpiredArchives()
  if (expiredArchives.length) {
    logger.info(`Unsaving ${expiredArchives.length} expired archives`)
  }
  var promises = []
  for (let i = 0; i < expiredArchives.length; i++) {
    promises.push(archivesDb.setUserSettings(0, expiredArchives[i].key, {isSaved: false}))
  }
  await Promise.all(promises)

  // now GC old archives
  var unusedArchives = await archivesDb.listGarbageCollectableArchives({olderThan, isOwner})
  if (unusedArchives.length) {
    logger.info(`Cleaning out ${unusedArchives.length} unused archives`)
    logger.silly('Archives:', {urls: unusedArchives.map(a => a.key)})
  }
  for (let i = 0; i < unusedArchives.length; i++) {
    await datLibrary.unloadArchive(unusedArchives[i].key)
    totalBytes += await archivesDb.deleteArchive(unusedArchives[i].key)
  }

  logger.debug(`GC completed in ${Date.now() - startTime} ms`)

  // schedule the next GC
  schedule(DAT_GC_REGULAR_COLLECT_WAIT)
  logger.debug(`Scheduling next run to happen in ${ms(DAT_GC_REGULAR_COLLECT_WAIT)}`)

  // return stats
  return {totalBytes, totalArchives: unusedArchives.length - skippedArchives, skippedArchives}
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
