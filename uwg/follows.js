const assert = require('assert')
const _difference = require('lodash.difference')
const Events = require('events')
const {URL} = require('url')
const Ajv = require('ajv')
const logger = require('../logger').child({category: 'uwg', dataset: 'follows'})
const lock = require('../lib/lock')
const knex = require('../lib/knex')
const db = require('../dbs/profile-data-db')
const uwg = require('./index')
const datArchives = require('../dat/archives')
const archivesDb = require('../dbs/archives')
const {doCrawl, doCheckpoint, emitProgressEvent} = require('./util')
const followsSchema = require('./json-schemas/follows')
const {PATHS} = require('../lib/const')
const {ensureDirectory} = require('./util')
const joinPath = require('path').join
const _differenceBy = require('lodash.differenceby')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/follows'
const JSON_PATH = '/.data/follows.json'

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef {import('../dbs/archives').LibraryArchiveMeta} LibraryArchiveMeta
 *
 * @typedef {Object} Follow
 * @prop {LibraryArchiveMeta} author
 * @prop {LibraryArchiveMeta} topic
 * @prop {string} visibility
 */

// globals
// =

const events = new Events()
const ajv = (new Ajv())
const validateFollows = ajv.compile(followsSchema)

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for follows.
 *
 * @param {DaemonDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise<void>}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_follows', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling follows', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_follows WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_follows', TABLE_VERSION, crawlSource, 0)
    }

    // did follows.json change?
    var change = changes.find(c => c.name === JSON_PATH)
    if (!change) {
      logger.debug('No change detected to follows record', {details: {url: archive.url}})
      if (changes.length) {
        await doCheckpoint('crawl_follows', TABLE_VERSION, crawlSource, changes[changes.length - 1].version)
      }
      return
    }

    logger.verbose('Change detected to follows record', {details: {url: archive.url}})
    emitProgressEvent(archive.url, 'crawl_follows', 0, 1)

    // read and validate
    try {
      var followsJson = await readFollowsFile(archive)
    } catch (err) {
      logger.warn('Failed to read follows file', {details: {url: archive.url, err}})
      return
    }

    // diff against the current follows
    var currentFollowRows = await db.all(
      knex('crawl_follows')
        .select('crawl_follows.*')
        .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_follows.crawlSourceId')
        .where('crawl_sources.url', archive.url)
    )
    var currentFollows = currentFollowRows.map(({destUrl}) => destUrl)
    var newFollows = followsJson.urls
    var adds = _difference(newFollows, currentFollows)
    var removes = _difference(currentFollows, newFollows)
    logger.silly(`Adding ${adds.length} follows and removing ${removes.length} follows`, {details: {url: archive.url}})

    // write updates
    for (let add of adds) {
      try {
        await db.run(`
          INSERT INTO crawl_follows (crawlSourceId, destUrl, crawledAt) VALUES (?, ?, ?)
        `, [crawlSource.id, add, Date.now()])
      } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT') {
          // uniqueness constraint probably failed, which means we got a duplicate somehow
          // dont worry about it
          logger.warn('Attempted to insert duplicate follow record', {details: {url: archive.url, add}})
        } else {
          throw e
        }
      }
      if (!supressEvents) {
        events.emit('follow-added', archive.url, add)
      }
    }
    for (let remove of removes) {
      await db.run(`
        DELETE FROM crawl_follows WHERE crawlSourceId = ? AND destUrl = ?
      `, [crawlSource.id, remove])
      if (supressEvents) {
        events.emit('follow-removed', archive.url, remove)
      }
    }

    // write checkpoint as success
    logger.silly(`Finished crawling follows`, {details: {url: archive.url}})
    await doCheckpoint('crawl_follows', TABLE_VERSION, crawlSource, changes[changes.length - 1].version)
    emitProgressEvent(archive.url, 'crawl_follows', 1, 1)
  })
}

/**
 * @description
 * List crawled follows.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.filters]
 * @param {string|string[]} [opts.filters.authors]
 * @param {string|string[]} [opts.filters.topics]
 * @param {string} [opts.filters.visibility]
 * @param {string} [opts.sortBy]
 * @param {number} [opts.offset=0]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Follow>>}
 */
const list = exports.list = async function (opts) {
  // TODO: handle visibility
  // TODO: sortBy options

  // validate & parse params
  if (opts && 'sortBy' in opts) assert(typeof opts.sortBy === 'string', 'SortBy must be a string')
  if (opts && 'offset' in opts) assert(typeof opts.offset === 'number', 'Offset must be a number')
  if (opts && 'limit' in opts) assert(typeof opts.limit === 'number', 'Limit must be a number')
  if (opts && 'reverse' in opts) assert(typeof opts.reverse === 'boolean', 'Reverse must be a boolean')
  if (opts && opts.filters) {
    if ('authors' in opts.filters) {
      if (Array.isArray(opts.filters.authors)) {
        assert(opts.filters.authors.every(v => typeof v === 'string'), 'Authors filter must be a string or array of strings')
      } else {
        assert(typeof opts.filters.authors === 'string', 'Authors filter must be a string or array of strings')
        opts.filters.authors = [opts.filters.authors]
      }
      opts.filters.authors = await Promise.all(opts.filters.authors.map(datArchives.getPrimaryUrl))
    }
    if ('topics' in opts.filters) {
      if (Array.isArray(opts.filters.topics)) {
        assert(opts.filters.topics.every(v => typeof v === 'string'), 'Topics filter must be a string or array of strings')
      } else {
        assert(typeof opts.filters.topics === 'string', 'Topics filter must be a string or array of strings')
        opts.filters.topics = [opts.filters.topics]
      }
      opts.filters.topics = await Promise.all(opts.filters.topics.map(datArchives.getPrimaryUrl))
    }
    if ('visibility' in opts.filters) {
      assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
    }
  }

  // execute query
  let sql = knex('crawl_follows')
    .select('crawl_follows.*')
    .select('crawl_sources.url AS authorUrl')
    .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_follows.crawlSourceId')
    .orderBy('crawl_follows.destUrl', opts.reverse ? 'DESC' : 'ASC')
  if (opts.limit) sql = sql.limit(opts.limit)
  if (opts.offset) sql = sql.offset(opts.offset)
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }
  if (opts && opts.filters && opts.filters.topics) {
    sql = sql.whereIn('crawl_follows.destUrl', opts.filters.topics)
  }
  var rows = await db.all(sql)

  // massage results
  return (await Promise.all(rows.map(async (row) => {
    var author = toOrigin(row.authorUrl)
    var topic = toOrigin(row.destUrl)
    return {
      author: await archivesDb.getMeta(author),
      topic: await archivesDb.getMeta(topic),
      visibility: 'public'
    }
  }))).filter(record => !!record.author && !!record.topic)
}

/**
 * @description
 * Get an individual follow.
 *
 * @param {string} author - (URL) the site being queried.
 * @param {string} topic - (URL) does a follow this site?
 * @returns {Promise<Follow>}
 */
const get = exports.get = async function (author, topic) {
  author = await datArchives.getPrimaryUrl(author)
  topic = await datArchives.getPrimaryUrl(topic)
  var res = await db.get(knex('crawl_follows')
    .select('crawl_follows.*')
    .select('crawl_sources.url AS authorUrl')
    .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_follows.crawlSourceId')
    .where('crawl_sources.url', author)
    .where('crawl_follows.destUrl', topic))
  if (!res) return null
  var record = {
    author: await archivesDb.getMeta(toOrigin(res.authorUrl)),
    topic: await archivesDb.getMeta(toOrigin(res.destUrl)),
    visibility: 'public'
  }
  if (!record.author || !record.topic) return null
  return record
}

/**
 * @description
 * Add a follow to the given archive.
 *
 * @param {DaemonDatArchive} archive
 * @param {string} topic
 * @param {Object} [opts]
 * @param {string} [opts.visibility]
 * @returns {Promise<void>}
 */
exports.add = async function (archive, topic, opts) {
  // TODO visibility

  // normalize topic
  topic = await datArchives.getPrimaryUrl(topic)
  assert(typeof topic === 'string', 'Follow() must be given a valid URL')

  // persist
  var followUrls = await updateFollowsFile(archive, followsJson => {
    if (!followsJson.urls.find(v => v === topic)) {
      followsJson.urls.push(topic)
    }
  })
  await updateFollowsMounts(archive, followUrls)
}

/**
 * @description
 * Edit a follow for the given archive.
 *
 * @param {DaemonDatArchive} archive
 * @param {string} topic
 * @param {Object} [opts]
 * @param {string} [opts.visibility]
 * @returns {Promise<void>}
 */
exports.edit = async function (archive, topic, opts) {
  // TODO visibility

  // normalize topic
  topic = await datArchives.getPrimaryUrl(topic)
  assert(typeof topic === 'string', 'Follow() must be given a valid URL')

  // persist
  var followUrls = await updateFollowsFile(archive, followsJson => {
    if (!followsJson.urls.find(v => v === topic)) {
      followsJson.urls.push(topic)
    }
  })
  await updateFollowsMounts(archive, followUrls)
}

/**
 * @description
 * Remove a follow from the given archive.
 *
 * @param {DaemonDatArchive} archive
 * @param {string} topic
 * @returns {Promise<void>}
 */
exports.remove = async function (archive, topic) {
  // TODO private follows

  // normalize topic
  topic = await datArchives.getPrimaryUrl(topic)
  assert(typeof topic === 'string', 'Unfollow() must be given a valid URL')

  // persist
  var followUrls = await updateFollowsFile(archive, followsJson => {
    var i = followsJson.urls.findIndex(v => v === topic)
    if (i !== -1) {
      followsJson.urls.splice(i, 1)
    }
  })
  await updateFollowsMounts(archive, followUrls)
}

// internal methods
// =

/**
 * @param {string} url
 * @returns {string}
 */
function toOrigin (url) {
  try {
    var urlParsed = new URL(url)
    return urlParsed.protocol + '//' + urlParsed.hostname
  } catch (e) {
    return null
  }
}

/**
 * @param {DaemonDatArchive} archive
 * @returns {Promise<Object>}
 */
async function readFollowsFile (archive) {
  try {
    var followsJson = await archive.pda.readFile(JSON_PATH, 'utf8')
  } catch (e) {
    if (e.notFound) return {type: JSON_TYPE, urls: []} // empty default when not found
    throw e
  }
  followsJson = JSON.parse(followsJson)
  var valid = validateFollows(followsJson)
  if (!valid) throw ajv.errorsText(validateFollows.errors)
  return followsJson
}

/**
 * @param {DaemonDatArchive} archive
 * @param {function(Object): void} updateFn
 * @returns {Promise<string[]>}
 */
async function updateFollowsFile (archive, updateFn) {
  var origFollowsUrls
  var followUrls
  var release = await lock('crawler:follows:' + archive.url)
  try {
    // read the follows file
    try {
      var followsJson = await readFollowsFile(archive)
    } catch (err) {
      if (err.notFound) {
        // create new
        followsJson = {
          type: JSON_TYPE,
          urls: []
        }
      } else {
        logger.warn('Failed to read follows file', {details: {url: archive.url, err}})
        throw err
      }
    }

    // apply update
    origFollowsUrls = followsJson.urls
    updateFn(followsJson)
    followUrls = followsJson.urls

    // write the follows file
    await ensureDirectory(archive, '/.data')
    await archive.pda.writeFile(JSON_PATH, JSON.stringify(followsJson, null, 2), 'utf8')

    // trigger crawl now
    await uwg.crawlSite(archive)
  } catch (e) {
    followUrls = origFollowsUrls // fallback to original, update failed
    throw e
  } finally {
    release()
  }
  return followUrls
}

/**
 * @param {DaemonDatArchive} archive
 * @param {string[]} followUrls
 */
async function updateFollowsMounts (archive, followUrls) {
  // resolve all followUrls to keys
  var followKeys = []
  for (let url of followUrls) {
    try {
      followKeys.push(await datArchives.fromURLToKey(url, true))
    } catch (e) {
      // skip, which will cause it to unmount for now
    }
  }

  // get current list of followed URLs
  await ensureDirectory(archive, PATHS.REFS_FOLLOWED_DATS)
  var mountNames = await archive.pda.readdir(PATHS.REFS_FOLLOWED_DATS)
  var mounts = []
  for (let name of mountNames) {
    let st = await archive.pda.stat(joinPath(PATHS.REFS_FOLLOWED_DATS, name)).catch(err => null)
    if (st && st.mount) {
      mounts.push({name, key: st.mount.key.toString('hex')})
    }
  }

  // add/remove as needed
  var adds = _differenceBy(followKeys, mounts, v => v.key ? v.key : v)
  for (let add of adds) {
    await archive.pda.mount(joinPath(PATHS.REFS_FOLLOWED_DATS, add), add)
  }
  var removes = _differenceBy(mounts, followKeys, v => v.key ? v.key : v)
  for (let remove of removes) {
    await archive.pda.unmount(joinPath(PATHS.REFS_FOLLOWED_DATS, remove.name))
  }
}
