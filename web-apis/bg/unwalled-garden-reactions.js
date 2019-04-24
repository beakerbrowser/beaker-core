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
 * @prop {string} topic
 * @prop {string[]} emojis
 * @prop {ReactionAuthorPublicAPIRecord} author
 * @prop {number} crawledAt
 * @prop {Object} record
 * @prop {string} record.url
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.authors]
   * @param {number} [opts.offset=0]
   * @param {number} [opts.limit]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<ReactionPublicAPIRecord[]>}
   */
  async query (opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    opts = (opts && typeof opts === 'object') ? opts : {}
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
    }
    var reactions = await reactionsCrawler.query(opts)
    return Promise.all(reactions.map(massageReactionRecord))
  },

  innerListReactions,

  /**
   * @param {string} topic
   * @returns {Promise<TopicReactionsPublicAPIRecord[]>}
   */
  async listReactions (topic) {
    await assertPermission(this.sender, 'dangerousAppControl')

    topic = normalizeTopicUrl(topic)
    assert(topic && typeof topic === 'string', 'The `topic` parameter must be a valid URL')

    return innerListReactions(topic)
  },

  /**
   * @param {string} topic
   * @param {string} emoji
   * @returns {Promise<void>}
   */
  async addReaction (topic, emoji) {
    await assertPermission(this.sender, 'dangerousAppControl')

    topic = normalizeTopicUrl(topic)
    assert(topic && typeof topic === 'string', 'The `topic` parameter must be a valid URL')

    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var userArchive = dat.library.getArchive(userSession.url)

    await reactionsCrawler.addReaction(userArchive, topic, emoji)
  },

  /**
   * @param {string} topic
   * @param {string} emoji
   * @returns {Promise<void>}
   */
  async deleteReaction (topic, emoji) {
    await assertPermission(this.sender, 'dangerousAppControl')

    topic = normalizeTopicUrl(topic)
    assert(topic && typeof topic === 'string', 'The `topic` parameter must be a valid URL')

    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var userArchive = dat.library.getArchive(userSession.url)

    await reactionsCrawler.deleteReaction(userArchive, topic, emoji)
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

function normalizeTopicUrl (url) {
  try {
    url = new URL(url)
    return (url.protocol + '//' + url.hostname + url.pathname + url.search + url.hash).replace(/([/]$)/g, '')
  } catch (e) {}
  return null
}

/**
 * @param {string} topic
 * @returns {Promise<TopicReactionsPublicAPIRecord[]>}
 */
async function innerListReactions (topic) {
  var reactions = await reactionsCrawler.listReactions(topic)
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
}

/**
 * @param {Reaction} reaction
 * @returns {Promise<ReactionPublicAPIRecord>}
 */
async function massageReactionRecord (reaction) {
  var desc = await siteDescriptionsCrawler.getBest({subject: reaction.author})
  return {
    topic: reaction.topic,
    emojis: reaction.emojis,
    crawledAt: reaction.crawledAt,
    author: {
      url: desc.url,
      title: desc.title,
      description: desc.description,
      type: desc.type
    },
    record: {
      url: reaction.recordUrl
    }
  }
}