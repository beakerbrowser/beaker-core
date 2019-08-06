const globals = require('../../globals')
const assert = require('assert')
const {URL} = require('url')
const dat = require('../../dat')
const commentsCrawler = require('../../crawler/comments')
const sessionPerms = require('../../lib/session-perms')

// typedefs
// =

/**
 * @typedef {Object} CommentAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 *
 * @typedef {Object} CommentPublicAPIRecord
 * @prop {string} url
 * @prop {string} topic
 * @prop {string} replyTo
 * @prop {string} body
 * @prop {string} createdAt
 * @prop {string} updatedAt
 * @prop {CommentAuthorPublicAPIRecord} author
 * @prop {string} visibility
 *
 * @typedef {Object} ThreadedCommentPublicAPIRecord
 * @prop {string} url
 * @prop {string} topic
 * @prop {string} replyTo
 * @prop {string} body
 * @prop {ThreadedCommentPublicAPIRecord[]} replies
 * @prop {number} replyCount
 * @prop {string} createdAt
 * @prop {string} updatedAt
 * @prop {CommentAuthorPublicAPIRecord} author
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
   * @returns {Promise<CommentPublicAPIRecord[]>}
   */
  async list (opts) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/comments', 'read')
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

    var comments = await commentsCrawler.list(opts)
    return Promise.all(comments.map(massageCommentRecord))
  },

  /**
   * @param {string} topic
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string} [opts.filters.visibility]
   * @param {string} [opts.parent]
   * @param {number} [opts.depth]
   * @param {string} [opts.sortBy]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<CommentPublicAPIRecord[]>}
   */
  async thread (topic, opts) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/comments', 'read')
    opts = (opts && typeof opts === 'object') ? opts : {}
    assert(topic && typeof topic === 'string', 'The `topic` parameter must be a URL string')
    if (opts && 'parent' in opts) assert(typeof opts.parent === 'string', 'Parent must be a string')
    if (opts && 'depth' in opts) assert(typeof opts.depth === 'number', 'Depth must be a number')
    if (opts && 'sortBy' in opts) assert(typeof opts.sortBy === 'string', 'SortBy must be a string')
    if (opts && 'reverse' in opts) assert(typeof opts.reverse === 'boolean', 'Reverse must be a boolean')
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

    var comments = await commentsCrawler.thread(topic, opts)
    return Promise.all(comments.map(massageThreadedCommentRecord))
  },

  /**
   * @param {string} url
   * @returns {Promise<CommentPublicAPIRecord>}
   */
  async get (url) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/comments', 'read')
    return massageCommentRecord(await commentsCrawler.get(url))
  },

  /**
   * @param {Object|string} comment
   * @param {string} topic
   * @param {string} comment.replyTo
   * @param {string} comment.body
   * @param {string} [comment.visibility]
   * @returns {Promise<CommentPublicAPIRecord>}
   */
  async add (topic, comment) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/comments', 'write')
    var userArchive = await sessionPerms.getSessionUserArchive(this.sender)

    // string usage
    if (typeof comment === 'string') {
      comment = {body: comment}
    }

    assert(topic && typeof topic === 'string', 'The `topic` parameter must be a URL string')
    assert(comment && typeof comment === 'object', 'The `comment` parameter must be a string or object')
    assert(comment.body && typeof comment.body === 'string', 'The `comment.body` parameter must be a non-empty string')
    if ('replyTo' in comment) assert(typeof comment.replyTo === 'string', 'The `comment.replyTo` parameter must be a string')
    if ('visibility' in comment) assert(typeof comment.visibility === 'string', 'The `comment.visibility` parameter must be "public" or "private"')

    // default values
    if (!comment.visibility) {
      comment.visibility = 'public'
    }

    var url = await commentsCrawler.add(userArchive, topic, comment)
    return massageCommentRecord(await commentsCrawler.get(url))
  },

  /**
   * @param {string} url
   * @param {Object|string} comment
   * @param {string} comment.replyTo
   * @param {string} comment.body
   * @param {string} [comment.visibility]
   * @returns {Promise<CommentPublicAPIRecord>}
   */
  async edit (url, comment) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/comments', 'write')
    var userArchive = await sessionPerms.getSessionUserArchive(this.sender)

    // string usage
    if (typeof comment === 'string') {
      comment = {body: comment}
    }

    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')
    assert(comment && typeof comment === 'object', 'The `comment` parameter must be a string or object')
    if ('body' in comment) assert(typeof comment.body === 'string', 'The `comment.body` parameter must be a string')
    if ('replyTo' in comment) assert(typeof comment.replyTo === 'string', 'The `comment.replyTo` parameter must be a string')
    if ('visibility' in comment) assert(typeof comment.visibility === 'string', 'The `comment.visibility` parameter must be "public" or "private"')

    var filepath = await urlToFilepath(url, userArchive.url)
    await commentsCrawler.edit(userArchive, filepath, comment)
    return massageCommentRecord(await commentsCrawler.get(userArchive.url + filepath))
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async remove (url) {
    await sessionPerms.assertCan(this.sender, 'unwalled.garden/api/comments', 'write')
    var userArchive = await sessionPerms.getSessionUserArchive(this.sender)

    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')

    var filepath = await urlToFilepath(url, userArchive.url)
    await commentsCrawler.remove(userArchive, filepath)
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
    throw new Error('Unable to edit comments on other sites than your own')
  }

  return filepath
}

/**
 * @param {Object} comment
 * @returns {CommentPublicAPIRecord}
 */
function massageCommentRecord (comment) {
  if (!comment) return null
  var url =  comment.author.url + comment.pathname
  return {
    url,
    topic: comment.topic,
    replyTo: comment.replyTo,
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: {
      url: comment.author.url,
      title: comment.author.title,
      description: comment.author.description,
      type: comment.author.type
    },
    visibility: comment.visibility
  }
}

/**
 * @param {Object} comment
 * @returns {ThreadedCommentPublicAPIRecord}
 */
function massageThreadedCommentRecord (comment) {
  if (!comment) return null
  var url =  comment.author.url + comment.pathname
  return {
    url,
    topic: comment.topic,
    replyTo: comment.replyTo,
    body: comment.body,
    replies: comment.replies ? comment.replies.map(massageThreadedCommentRecord) : null,
    replyCount: comment.replyCount,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: {
      url: comment.author.url,
      title: comment.author.title,
      description: comment.author.description,
      type: comment.author.type
    },
    visibility: comment.visibility
  }
}
