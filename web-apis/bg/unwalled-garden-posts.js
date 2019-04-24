const globals = require('../../globals')
const assert = require('assert')
const {URL} = require('url')
const {PermissionsError} = require('beaker-error-constants')
const dat = require('../../dat')
const postsCrawler = require('../../crawler/posts')
const reactionsAPI = require('./unwalled-garden-reactions')

// typedefs
// =

/**
 * @typedef {Object} PostAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 *
 * @typedef {Object} PostReactionAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 *
 * @typedef {Object} PostReactionPublicAPIRecord
 * @prop {string} emoji
 * @prop {PostReactionAuthorPublicAPIRecord[]} authors
 *
 * @typedef {Object} PostPublicAPIRecord
 * @prop {string} url
 * @prop {Object} content
 * @prop {string} content.body
 * @prop {PostReactionPublicAPIRecord[]} reactions
 * @prop {number} crawledAt
 * @prop {number} createdAt
 * @prop {number} updatedAt
 * @prop {PostAuthorPublicAPIRecord} author
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
   * @returns {Promise<PostPublicAPIRecord[]>}
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
    var posts = await postsCrawler.query(opts)
    return Promise.all(posts.map(massagePostRecord))
  },

  /**
   * @param {string} url
   * @returns {Promise<PostPublicAPIRecord>}
   */
  async getPost (url) {
    await assertPermission(this.sender, 'dangerousAppControl')
    return massagePostRecord(await postsCrawler.getPost(url))
  },

  /**
   * @param {Object} post
   * @param {Object} post.content
   * @param {string} post.content.body
   * @returns {Promise<PostPublicAPIRecord>}
   */
  async addPost (post) {
    await assertPermission(this.sender, 'dangerousAppControl')

    assert(post && typeof post === 'object', 'The `post` parameter must be an object')
    assert(post.content && typeof post.content === 'object', 'The `post.content` parameter must be an object')
    assert(post.content.body && typeof post.content.body === 'string', 'The `post.content.body` parameter must be a non-empty string')

    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')

    var userArchive = dat.library.getArchive(userSession.url)
    var url = await postsCrawler.addPost(userArchive, post.content)
    return massagePostRecord(await postsCrawler.getPost(url))
  },

  /**
   * @param {string} url
   * @param {Object} post
   * @param {Object} post.content
   * @param {string} post.content.body
   * @returns {Promise<PostPublicAPIRecord>}
   */
  async editPost (url, post) {
    await assertPermission(this.sender, 'dangerousAppControl')

    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')
    assert(post && typeof post === 'object', 'The `post` parameter must be an object')
    assert(post.content && typeof post.content === 'object', 'The `post.content` parameter must be an object')
    assert(post.content.body && typeof post.content.body === 'string', 'The `post.content.body` parameter must be a non-empty string')

    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var filepath = await urlToFilepath(url, userSession.url)

    var userArchive = dat.library.getArchive(userSession.url)
    await postsCrawler.editPost(userArchive, filepath, post.content)
    return massagePostRecord(await postsCrawler.getPost(userSession.url + filepath))
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async deletePost (url) {
    await assertPermission(this.sender, 'dangerousAppControl')

    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')

    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var filepath = await urlToFilepath(url, userSession.url)

    var userArchive = dat.library.getArchive(userSession.url)
    await postsCrawler.deletePost(userArchive, filepath)
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
    throw new Error('Unable to edit posts on other sites than your own')
  }

  return filepath
}

async function massagePostRecord (post) {
  var url =  post.author.url + post.pathname
  return {
    url,
    content: {
      body: post.content.body
    },
    reactions: (await reactionsAPI.innerListReactions(url)).map(r => ({
      emoji: r.emoji,
      authors: r.authors.map(a => ({
        url: a.url,
        title: a.title
      }))
    })),
    crawledAt: post.crawledAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    author: {
      url: post.author.url,
      title: post.author.title,
      description: post.author.description,
      type: post.author.type
    }
  }
}
