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
 * @typedef {Object} ReactionAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 *
 * @typedef {Object} ReactionPublicAPIRecord
 * @prop {string} topic
 * @prop {string} emoji
 * @prop {ReactionAuthorPublicAPIRecord[]} authors
 */

// exported api
// =

/**
 * @param {string} topic
 * @returns {Promise<ReactionPublicAPIRecord[]>}
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

module.exports = {
  innerListReactions,

  /**
   * @param {string} topic
   * @returns {Promise<ReactionPublicAPIRecord[]>}
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