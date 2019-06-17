const globals = require('../../globals')
const assert = require('assert')
const {URL} = require('url')
const {PermissionsError} = require('beaker-error-constants')
const dat = require('../../dat')
const reactionsCrawler = require('../../crawler/reactions')
const siteDescriptionsCrawler = require('../../crawler/site-descriptions')

// typedefs
// =

/**
 * @typedef {import('../../crawler/reactions').Reaction} Reaction
 *
 * @typedef {Object} ReactionAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 *
 * @typedef {Object} TopicReactionsPublicAPIRecord
 * @prop {string} topic
 * @prop {string} emoji
 * @prop {ReactionAuthorPublicAPIRecord[]} authors
 *
 * @typedef {Object} ReactionPublicAPIRecord
 * @prop {string} url
 * @prop {string} topic
 * @prop {string[]} emojis
 * @prop {ReactionAuthorPublicAPIRecord} author
 * @prop {string} visibility
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string|string[]} [opts.filters.topics]
   * @param {string} [opts.filters.visibility]
   * @param {string} [opts.sortBy]
   * @param {number} [opts.offset=0]
   * @param {number} [opts.limit]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<ReactionPublicAPIRecord[]>}
   */
  async list (opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    opts = (opts && typeof opts === 'object') ? opts : {}
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
        }
      }
      if ('topics' in opts.filters) {
        if (Array.isArray(opts.filters.topics)) {
          assert(opts.filters.topics.every(v => typeof v === 'string'), 'Topics filter must be a string or array of strings')
        } else {
          assert(typeof opts.filters.topics === 'string', 'Topics filter must be a string or array of strings')
        }
      }
      if ('visibility' in opts.filters) {
        assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
      }
    }
    var reactions = await reactionsCrawler.list(opts)
    return Promise.all(reactions.map(massageReactionRecord))
  },

  /**
   * @param {string} topic
   * @param {Object} [opts]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string} [opts.filters.visibility]
   * @returns {Promise<TopicReactionsPublicAPIRecord[]>}
   */
  async tabulate (topic, opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    topic = normalizeTopicUrl(topic)
    assert(topic && typeof topic === 'string', 'The `topic` parameter must be a valid URL')
    opts = (opts && typeof opts === 'object') ? opts : {}
    if (opts && opts.filters) {
      if ('authors' in opts.filters) {
        if (Array.isArray(opts.filters.authors)) {
          assert(opts.filters.authors.every(v => typeof v === 'string'), 'Authors filter must be a string or array of strings')
        } else {
          assert(typeof opts.filters.authors === 'string', 'Authors filter must be a string or array of strings')
        }
      }
      if ('visibility' in opts.filters) {
        assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
      }
    }

    var reactions = await reactionsCrawler.tabulate(topic, opts)
    return Promise.all(reactions.map(async (reaction) => ({
      topic,
      emoji: reaction.emoji,
      authors: await Promise.all(reaction.authors.map(async (url) => {
        var desc = await siteDescriptionsCrawler.getBest({subject: url})
        return {
          url: desc.url,
          title: desc.title,
          description: desc.description,
          type: desc.type
        }
      }))
    })))
  },

  /**
   * @param {string} topic
   * @param {string} emoji
   * @returns {Promise<void>}
   */
  async add (topic, emoji) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var userArchive = getUserArchive(this.sender)

    topic = normalizeTopicUrl(topic)
    assert(topic && typeof topic === 'string', 'The `topic` parameter must be a valid URL')

    await reactionsCrawler.add(userArchive, topic, emoji)
  },

  /**
   * @param {string} topic
   * @param {string} emoji
   * @returns {Promise<void>}
   */
  async remove (topic, emoji) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var userArchive = getUserArchive(this.sender)

    topic = normalizeTopicUrl(topic)
    assert(topic && typeof topic === 'string', 'The `topic` parameter must be a valid URL')

    await reactionsCrawler.remove(userArchive, topic, emoji)
  }
}

// internal methods
// =

async function assertPermission (sender, perm) {
  if (sender.getURL().startsWith('beaker:')) {
    return true
  }
  if (await globals.permsAPI.requestPermission(perm, sender)) return true
  throw new PermissionsError()
}

function getUserArchive (sender) {
  var userSession = globals.userSessionAPI.getFor(sender)
  if (!userSession) throw new Error('No active user session')
  return dat.library.getArchive(userSession.url)
}

function normalizeTopicUrl (url) {
  try {
    url = new URL(url)
    return (url.protocol + '//' + url.hostname + url.pathname + url.search + url.hash).replace(/([/]$)/g, '')
  } catch (e) {}
  return null
}

/**
 * @param {Reaction} reaction
 * @returns {Promise<ReactionPublicAPIRecord>}
 */
async function massageReactionRecord (reaction) {
  var desc = await siteDescriptionsCrawler.getBest({subject: reaction.author})
  return {
    url: reaction.recordUrl,
    topic: reaction.topic,
    emojis: reaction.emojis,
    author: {
      url: desc.url,
      title: desc.title,
      description: desc.description,
      type: desc.type
    },
    visibility: reaction.visibility
  }
}