const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const Ajv = require('ajv')
const logger = require('../logger').child({category: 'uwg', dataset: 'reactions'})
const db = require('../dbs/profile-data-db')
const uwg = require('./index')
const datArchives = require('../dat/archives')
const lock = require('../lib/lock')
const knex = require('../lib/knex')
const {
  doCrawl,
  doCheckpoint,
  emitProgressEvent,
  getMatchingChangesInOrder,
  ensureDirectory,
  normalizeTopicUrl,
  slugifyUrl
} = require('./util')
const reactionSchema = require('./json-schemas/reaction')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/reaction'
const JSON_PATH_REGEX = /^\/\.data\/unwalled\.garden\/reactions\/([^/]+)\.json$/i

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 *
 * @typedef {Object} Reaction
 * @prop {string} topic
 * @prop {string[]} emojis
 * @prop {string} author
 * @prop {string} recordUrl
 * @prop {number} crawledAt
 *
 * @typedef {Object} TopicReaction
 * @prop {string} emoji
 * @prop {string[]} authors
 */

// globals
// =

const events = new Events()
const ajv = (new Ajv())
const validateReaction = ajv.compile(reactionSchema)

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for reactions.
 *
 * @param {DaemonDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_reactions', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling reactions', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_reactions WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_reactions', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed reactions
    var changedReactions = getMatchingChangesInOrder(changes, JSON_PATH_REGEX)
    if (changedReactions.length) {
      logger.verbose('Collected new/changed reaction files', {details: {url: archive.url, changedReactions: changedReactions.map(p => p.name)}})
    } else {
      logger.debug('No new reaction-files found', {details: {url: archive.url}})
    }
    emitProgressEvent(archive.url, 'crawl_reactions', 0, changedReactions.length)

    // read and apply each reaction in order
    var progress = 0
    for (let changedReaction of changedReactions) {
      // TODO Currently the crawler will abort reading the feed if any reaction fails to load
      //      this means that a single unreachable file can stop the forward progress of reaction indexing
      //      to solve this, we need to find a way to tolerate unreachable reaction-files without losing our ability to efficiently detect new reactions
      //      -prf
      if (changedReaction.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_reactions WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedReaction.name])
        events.emit('reaction-updated', archive.url)
      } else {
        // read
        let fileString
        try {
          fileString = await archive.pda.readFile(changedReaction.name, 'utf8')
        } catch (err) {
          logger.warn('Failed to read reaction file, aborting', {details: {url: archive.url, name: changedReaction.name, err}})
          return // abort indexing
        }

        // parse and validate
        let reaction
        try {
          reaction = JSON.parse(fileString)
          let valid = validateReaction(reaction)
          if (!valid) throw ajv.errorsText(validateReaction.errors)
        } catch (err) {
          logger.warn('Failed to parse reaction file, skipping', {details: {url: archive.url, name: changedReaction.name, err}})
          continue // skip
        }

        // massage record
        reaction.topic = normalizeTopicUrl(reaction.topic)

        // upsert
        await db.run(`
          INSERT OR REPLACE INTO crawl_reactions (crawlSourceId, pathname, crawledAt, topic, emojis)
            VALUES (?, ?, ?, ?, ?)
        `, [crawlSource.id, changedReaction.name, Date.now(), reaction.topic, reaction.emojis.join(',')])
        events.emit('reaction-updated', archive.url)
      }

      // checkpoint our progress
      logger.silly(`Finished crawling reactions`, {details: {url: archive.url}})
      await doCheckpoint('crawl_reactions', TABLE_VERSION, crawlSource, changedReaction.version)
      emitProgressEvent(archive.url, 'crawl_reactions', ++progress, changedReactions.length)
    }
  })
}

/**
 * @description
 * List crawled reactions.
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
 * @returns {Promise<Array<Reaction>>}
 */
exports.list = async function (opts) {
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
      opts.filters.topics = opts.filters.topics.map(normalizeTopicUrl)
    }
    if ('visibility' in opts.filters) {
      assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
    }
  }

  // execute query
  let sql = knex('crawl_reactions')
    .select('crawl_reactions.*')
    .select('crawl_sources.url AS author')
    .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_reactions.crawlSourceId')
    .orderBy('crawl_reactions.topic', opts.reverse ? 'DESC' : 'ASC')
  if (opts.limit) sql = sql.limit(opts.limit)
  if (opts.offset) sql = sql.offset(opts.offset)
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }
  if (opts && opts.filters && opts.filters.topics) {
    sql = sql.whereIn('crawl_reactions.topic', opts.filters.topics)
  }
  var rows = await db.all(sql)

  // massage results
  rows.forEach(row => {
    row.emojis = row.emojis.split(',')
    row.recordUrl = row.author + row.pathname
  })
  return rows
}

/**
 * @description
 * List crawled reactions on a topic.
 *
 * @param {string} topic - The URL of the topic
 * @param {Object} [opts]
 * @param {Object} [opts.filters]
 * @param {string|string[]} [opts.filters.authors]
 * @param {string} [opts.filters.visibility]
 * @returns {Promise<TopicReaction[]>}
 */
exports.tabulate = async function (topic, opts) {
  // TODO handle visibility

  // validate params
  try { new URL(topic) }
  catch (e) { throw new Error('Invalid URL: ' + topic) }
  topic = normalizeTopicUrl(topic)
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
    if ('visibility' in opts.filters) {
      assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
    }
  }

  // execute query
  var sql = knex('crawl_reactions')
    .select('crawl_reactions.*')
    .select('crawl_sources.url AS crawlSourceUrl')
    .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_reactions.crawlSourceId')
    .where('crawl_reactions.topic', topic)
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }
  var rows = await db.all(sql)

  // construct reactions list
  var reactions = {}
  rows.forEach(row => {
    row.emojis.split(',').forEach(emoji => {
      if (!reactions[emoji]) {
        reactions[emoji] = {emoji, authors: [row.crawlSourceUrl]}
      } else {
        reactions[emoji].authors.push(row.crawlSourceUrl)
      }
    })
  })

  return Object.values(reactions)
}

/**
 * @description
 * Create a new reaction.
 *
 * @param {DaemonDatArchive} archive - where to write the reaction to.
 * @param {string} topic
 * @param {string} emoji
 * @returns {Promise<void>}
 */
exports.add = async function (archive, topic, emoji) {
  // TODO handle visibility

  topic = normalizeTopicUrl(topic)
  emoji = emoji.replace('\uFE0F', '').replace('\uFE0E', '') // strip the emoji-enforcement token
  var valid = validateReaction({type: JSON_TYPE, topic, emojis: [emoji]})
  if (!valid) throw ajv.errorsText(validateReaction.errors)

  var filepath = `/.data/unwalled.garden/reactions/${slugifyUrl(topic)}.json`
  await ensureDirectory(archive, '/.data/unwalled.garden/reactions')
  await updateReactionFile(archive, filepath, topic, emoji, false)
  await uwg.crawlSite(archive)
}

/**
 * @description
 * Delete an existing reaction
 *
 * @param {DaemonDatArchive} archive - where to write the reaction to.
 * @param {string} topic
 * @param {string} emoji
 * @returns {Promise<void>}
 */
exports.remove = async function (archive, topic, emoji) {
  // TODO handle visibility

  topic = normalizeTopicUrl(topic)
  emoji = emoji.replace('\uFE0F', '').replace('\uFE0E', '') // strip the emoji-enforcement token
  var valid = validateReaction({type: JSON_TYPE, topic, emojis: [emoji]})
  if (!valid) throw ajv.errorsText(validateReaction.errors)

  var filepath = `/.data/unwalled.garden/reactions/${slugifyUrl(topic)}.json`
  await updateReactionFile(archive, filepath, topic, false, emoji)
  await uwg.crawlSite(archive)
}

// internal methods
// =

/**
 * @param {DaemonDatArchive} archive
 * @param {string} pathname
 * @returns {Promise<Object>}
 */
async function readReactionFile (archive, pathname) {
  try {
    var json = await archive.pda.readFile(pathname, 'utf8')
    json = JSON.parse(json)
    var valid = validateReaction(json)
    if (!valid) throw ajv.errorsText(validateReaction.errors)
    return json
  } catch (e) {
    // fallback to an empty on error
    return {
      type: JSON_TYPE,
      topic: '',
      emojis: []
    }
  }
}

/**
 * @param {DaemonDatArchive} archive
 * @param {string} pathname
 * @param {string} topic
 * @param {string|boolean} addEmoji
 * @param {string|boolean} removeEmoji
 * @returns {Promise<void>}
 */
async function updateReactionFile (archive, pathname, topic, addEmoji = false, removeEmoji = false) {
  var release = await lock('crawler:reactions:' + archive.url)
  try {
    // read the reaction file
    var reactionJson = await readReactionFile(archive, pathname)

    // apply update
    reactionJson.topic = topic
    if (addEmoji) reactionJson.emojis = Array.from(new Set(reactionJson.emojis.concat([addEmoji])))
    if (removeEmoji) reactionJson.emojis = reactionJson.emojis.filter(v => v !== removeEmoji)

    // write or delete the reaction file
    if (reactionJson.emojis.length) {
      await archive.pda.writeFile(pathname, JSON.stringify(reactionJson, null, 2), 'utf8')
    } else {
      await archive.pda.unlink(pathname)
    }
  } finally {
    release()
  }
}
