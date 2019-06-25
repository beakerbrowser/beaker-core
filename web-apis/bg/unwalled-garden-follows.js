const globals = require('../../globals')
const assert = require('assert')
const {URL} = require('url')
const {PermissionsError} = require('beaker-error-constants')
const dat = require('../../dat')
const followsCrawler = require('../../crawler/follows')

// typedefs
// =

/**
 * @typedef {Object} FollowsSitePublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 *
 * @typedef {Object} FollowsPublicAPIRecord
 * @prop {FollowsSitePublicAPIRecord} author
 * @prop {FollowsSitePublicAPIRecord} topic
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
   * @returns {Promise<FollowsPublicAPIRecord[]>}
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
    var links = await followsCrawler.list(opts)
    return Promise.all(links.map(massageFollowRecord))
  },

  /**
   * @param {string} author
   * @param {string} topic
   * @returns {Promise<FollowsPublicAPIRecord>}
   */
  async get (author, topic) {
    await assertPermission(this.sender, 'dangerousAppControl')

    author = normalizeFollowUrl(author)
    topic = normalizeFollowUrl(topic)

    assert(author, 'The `author` parameter must be a valid URL')
    assert(topic, 'The `topic` parameter must be a valid URL')

    return followsCrawler.get(author, topic)
  },

  /**
   * @param {string} topic
   * @param {Object} [opts]
   * @param {string} [opts.visibility]
   * @returns {Promise<void>}
   */
  async add (topic, opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var userArchive = getUserArchive(this.sender)

    topic = normalizeFollowUrl(topic)
    if (!opts) opts = {}
    if (!opts.visibility) opts.visibility = 'public'
    assert(topic, 'The `topic` parameter must be a valid URL')
    assert(['public', 'private'].includes(opts.visibility), 'The `visibility` parameter must be "public" or "private"')

    await followsCrawler.add(userArchive, topic, opts)
  },

  /**
   * @param {string} topic
   * @param {Object} [opts]
   * @param {string} [opts.visibility]
   * @returns {Promise<void>}
   */
  async edit (topic, opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var userArchive = getUserArchive(this.sender)

    topic = normalizeFollowUrl(topic)
    if (!opts) opts = {}
    if (!opts.visibility) opts.visibility = 'public'
    assert(topic, 'The `topic` parameter must be a valid URL')
    assert(['public', 'private'].includes(opts.visibility), 'The `visibility` parameter must be "public" or "private"')

    await followsCrawler.edit(userArchive, topic, opts)
  },

  /**
   * @param {string} topic
   * @returns {Promise<void>}
   */
  async remove (topic) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var userArchive = getUserArchive(this.sender)

    topic = normalizeFollowUrl(topic)
    assert(topic, 'The `topic` parameter must be a valid URL')

    await followsCrawler.remove(userArchive, topic)
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

/**
 * @param {string} url
 * @returns {string}
 */
function normalizeFollowUrl (url) {
  try {
    url = new URL(url)
    return url.protocol + '//' + url.hostname
  } catch (e) {}
  return null
}

/**
 * @param {Object} site
 * @returns {FollowsSitePublicAPIRecord}
 */
function massageSiteRecord (site) {
  if (!site) return null
  return {
    url: site.url,
    title: site.title,
    description: site.description,
    type: site.type
  }
}

/**
 * @param {Object} follow
 * @returns {FollowsPublicAPIRecord}
 */
function massageFollowRecord (follow) {
  return {
    author: massageSiteRecord(follow.author),
    topic: massageSiteRecord(follow.topic),
    visibility: follow.visibility
  }
}