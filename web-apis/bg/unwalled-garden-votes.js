const globals = require('../../globals')
const assert = require('assert')
const {URL} = require('url')
const dat = require('../../dat')
const votesCrawler = require('../../crawler/votes')
const sessionPerms = require('../../lib/session-perms')

// typedefs
// =

/**
 * @typedef {import('../../crawler/votes').Vote} Vote
 * @typedef {import('../../crawler/votes').TabulatedVotes} TabulatedVotes
 *
 * @typedef {Object} VoteAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 *
 * @typedef {Object} TabulatedVotesPublicAPIRecord
 * @prop {string} topic
 * @prop {number} upvotes
 * @prop {VoteAuthorPublicAPIRecord[]} upvoters
 * @prop {number} downvotes
 * @prop {VoteAuthorPublicAPIRecord[]} downvoters
 *
 * @typedef {Object} VotePublicAPIRecord
 * @prop {string} url
 * @prop {string} topic
 * @prop {number} vote
 * @prop {string} createdAt
 * @prop {string} updatedAt
 * @prop {VoteAuthorPublicAPIRecord} author
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
   * @returns {Promise<VotePublicAPIRecord[]>}
   */
  async list (opts) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/votes', 'read')
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
    var votes = await votesCrawler.list(opts)
    return votes.map(massageVoteRecord)
  },

  /**
   * @param {string} topic
   * @param {Object} [opts]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string} [opts.filters.visibility]
   * @returns {Promise<TabulatedVotesPublicAPIRecord>}
   */
  async tabulate (topic, opts) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/votes', 'read')
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

    var tally = await votesCrawler.tabulate(topic, opts)
    return {
      topic: tally.topic,
      upvotes: tally.upvotes,
      upvoters: tally.upvoters.map(author => ({
        url: author.url,
        title: author.title,
        description: author.description,
        type: author.type
      })),
      downvotes: tally.downvotes,
      downvoters: tally.downvoters.map(author => ({
        url: author.url,
        title: author.title,
        description: author.description,
        type: author.type
      }))
    }
  },

  /**
   * @param {string} author
   * @param {string} topic
   * @returns {Promise<VotePublicAPIRecord>}
   */
  async get (author, topic) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/votes', 'read')
    return massageVoteRecord(await votesCrawler.get(author, topic))
  },

  /**
   * @param {string} topic
   * @param {string} emoji
   * @returns {Promise<VotePublicAPIRecord>}
   */
  async set (topic, vote) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/votes', 'write')
    var userArchive = await sessionPerms.getSessionUserArchive(this.sender)

    topic = normalizeTopicUrl(topic)
    assert(topic && typeof topic === 'string', 'The `topic` parameter must be a valid URL')

    await votesCrawler.set(userArchive, topic, vote)
    return massageVoteRecord(await votesCrawler.get(userArchive.url, topic))
  }
}

// internal methods
// =

function normalizeTopicUrl (url) {
  try {
    url = new URL(url)
    return (url.protocol + '//' + url.hostname + url.pathname + url.search + url.hash).replace(/([/]$)/g, '')
  } catch (e) {}
  return null
}

/**
 * @param {Vote} vote
 * @returns {VotePublicAPIRecord}
 */
function massageVoteRecord (vote) {
  if (!vote) return null
  var url =  vote.author.url + vote.pathname
  return {
    url,
    topic: vote.topic,
    vote: vote.vote,
    createdAt: vote.createdAt,
    updatedAt: vote.updatedAt,
    author: {
      url: vote.author.url,
      title: vote.author.title,
      description: vote.author.description,
      type: vote.author.type
    },
    visibility: vote.visibility
  }
}