const globals = require('../../globals')
const assert = require('assert')
const {URL} = require('url')
const dat = require('../../dat')
const discussionsCrawler = require('../../crawler/discussions')
const appPerms = require('../../lib/app-perms')

// typedefs
// =

/**
 * @typedef {Object} DiscussionAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 *
 * @typedef {Object} DiscussionPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} body
 * @prop {string} href
 * @prop {string[]} tags
 * @prop {string} createdAt
 * @prop {string} updatedAt
 * @prop {DiscussionAuthorPublicAPIRecord} author
 * @prop {string} visibility
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string|string[]} [opts.filters.tags]
   * @param {string} [opts.filters.visibility]
   * @param {string} [opts.sortBy]
   * @param {number} [opts.offset=0]
   * @param {number} [opts.limit]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<DiscussionPublicAPIRecord[]>}
   */
  async list (opts) {
    await appPerms.assertCan(this.sender, 'unwalled.garden/perm/discussions', 'read')
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
      if ('tags' in opts.filters) {
        if (Array.isArray(opts.filters.tags)) {
          assert(opts.filters.tags.every(v => typeof v === 'string'), 'Tags filter must be a string or array of strings')
        } else {
          assert(typeof opts.filters.tags === 'string', 'Tags filter must be a string or array of strings')
        }
      }
      if ('visibility' in opts.filters) {
        assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
      }
    }
    var discussions = await discussionsCrawler.list(opts)
    return Promise.all(discussions.map(massageDiscussionRecord))
  },

  /**
   * @param {string} url
   * @returns {Promise<DiscussionPublicAPIRecord>}
   */
  async get (url) {
    await appPerms.assertCan(this.sender, 'unwalled.garden/perm/discussions', 'read')
    return massageDiscussionRecord(await discussionsCrawler.get(url))
  },

  /**
   * @param {Object} discussion
   * @param {string} discussion.title
   * @param {string} discussion.body
   * @param {string} discussion.href
   * @param {string[]} discussion.tags
   * @param {string} discussion.visibility
   * @returns {Promise<DiscussionPublicAPIRecord>}
   */
  async add (discussion) {
    await appPerms.assertCan(this.sender, 'unwalled.garden/perm/discussions', 'write')
    var userArchive = await appPerms.getSessionUserArchive(this.sender)

    assert(discussion && typeof discussion === 'object', 'The `discussion` parameter must be a string or object')
    assert(discussion.title && typeof discussion.title === 'string', 'The `discussion.title` parameter must be a non-empty string')
    if ('body' in discussion) assert(typeof discussion.body === 'string', 'The `discussion.body` parameter must be a string')
    if ('href' in discussion) assert(typeof discussion.href === 'string', 'The `discussion.href` parameter must be a string')
    if ('tags' in discussion) assert(discussion.tags.every(tag => typeof tag === 'string'), 'The `discussion.tags` parameter must be an array of strings')
    if ('visibility' in discussion) assert(typeof discussion.visibility === 'string', 'The `discussion.visibility` parameter must be "public" or "private"')

    // default values
    if (!discussion.visibility) {
      discussion.visibility = 'public'
    }

    var url = await discussionsCrawler.add(userArchive, discussion)
    return massageDiscussionRecord(await discussionsCrawler.get(url))
  },

  /**
   * @param {string} url
   * @param {Object} discussion
   * @param {string} discussion.title
   * @param {string} discussion.body
   * @param {string} discussion.href
   * @param {string[]} discussion.tags
   * @param {string} discussion.visibility
   * @returns {Promise<DiscussionPublicAPIRecord>}
   */
  async edit (url, discussion) {
    await appPerms.assertCan(this.sender, 'unwalled.garden/perm/discussions', 'write')
    var userArchive = await appPerms.getSessionUserArchive(this.sender)

    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')
    assert(discussion && typeof discussion === 'object', 'The `discussion` parameter must be an object')
    if ('title' in discussion) assert(discussion.title && typeof discussion.title === 'string', 'The `discussion.title` parameter must be a non-empty string')
    if ('body' in discussion) assert(typeof discussion.body === 'string', 'The `discussion.body` parameter must be a string')
    if ('href' in discussion) assert(typeof discussion.href === 'string', 'The `discussion.href` parameter must be a string')
    if ('tags' in discussion) assert(discussion.tags.every(tag => typeof tag === 'string'), 'The `discussion.tags` parameter must be an array of strings')
    if ('visibility' in discussion) assert(typeof discussion.visibility === 'string', 'The `discussion.visibility` parameter must be "public" or "private"')

    var filepath = await urlToFilepath(url, userArchive.url)
    await discussionsCrawler.edit(userArchive, filepath, discussion)
    return massageDiscussionRecord(await discussionsCrawler.get(userArchive.url + filepath))
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async remove (url) {
    await appPerms.assertCan(this.sender, 'unwalled.garden/perm/discussions', 'write')
    var userArchive = await appPerms.getSessionUserArchive(this.sender)

    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')

    var filepath = await urlToFilepath(url, userArchive.url)
    await discussionsCrawler.remove(userArchive, filepath)
  }
}

// internal methods
// =

/**
 * Tries to parse the URL and return the pathname. If fails, assumes the string was a pathname.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function urlToFilepath (url, origin) {
  var urlp
  var filepath
  try {
    // if `url` is a full URL, extract the path
    urlp = new URL(url)
    filepath = urlp.pathname
  } catch (e) {
    // assume `url` is a path
    return url
  }

  // double-check the origin
  var key = await dat.dns.resolveName(urlp.hostname)
  var urlp2 = new URL(origin)
  if (key !== urlp2.hostname) {
    throw new Error('Unable to edit discussions on other sites than your own')
  }

  return filepath
}

/**
 * @param {Object} discussion
 * @returns {DiscussionPublicAPIRecord}
 */
function massageDiscussionRecord (discussion) {
  if (!discussion) return null
  var url =  discussion.author.url + discussion.pathname
  return {
    url,
    title: discussion.title,
    body: discussion.body,
    href: discussion.href,
    tags: discussion.tags,
    createdAt: discussion.createdAt,
    updatedAt: discussion.updatedAt,
    author: {
      url: discussion.author.url,
      title: discussion.author.title,
      description: discussion.author.description,
      type: discussion.author.type
    },
    visibility: discussion.visibility
  }
}
