const globals = require('../../globals')
const assert = require('assert')
const {URL} = require('url')
const {PermissionsError} = require('beaker-error-constants')
const dat = require('../../dat')
const archivesDb = require('../../dbs/archives')
const feedCrawler = require('../../crawler/feed')

// typedefs
// =

/**
 * @typedef {Object} FeedAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<string>} type 
 * 
 * @typedef {Object} FeedPostPublicAPIRecord
 * @prop {string} url
 * @prop {Object} content
 * @prop {string} content.body
 * @prop {number} crawledAt
 * @prop {number} createdAt
 * @prop {number} updatedAt
 * @prop {FeedAuthorPublicAPIRecord} author
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
   * @returns {Promise<FeedPostPublicAPIRecord[]>}
   */
  async query (opts) {
    await assertPermission(this.sender, 'dangerousAppControl')
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
    var posts = await feedCrawler.query(opts)
    return Promise.all(posts.map(massagePostRecord))
  },

  /**
   * @param {string} url
   * @returns {Promise<FeedPostPublicAPIRecord>}
   */
  async getPost (url) {
    await assertPermission(this.sender, 'dangerousAppControl')
    return massagePostRecord(await feedCrawler.getPost(url))
  },

  /**
   * @param {Object} post 
   * @param {Object} post.content
   * @param {string} post.content.body
   * @returns {Promise<void>}
   */
  async addPost (post) {
    await assertPermission(this.sender, 'dangerousAppControl')

    assert(post && typeof post === 'object', 'The `post` parameter must be an object')
    assert(post.content && typeof post.content === 'object', 'The `post.content` parameter must be an object')
    assert(post.content.body && typeof post.content.body === 'string', 'The `post.content.body` parameter must be a non-empty string')

    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    
    var userArchive = dat.library.getArchive(userSession.url)
    await feedCrawler.addPost(userArchive, post.content)
  },

  /**
   * @param {string} url
   * @param {Object} post 
   * @param {Object} post.content
   * @param {string} post.content.body
   * @returns {Promise<void>}
   */
  async editPost (url, post) {
    await assertPermission(this.sender, 'dangerousAppControl')

    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')
    assert(post && typeof post === 'object', 'The `post` parameter must be an object')
    assert(post.content && typeof post.content === 'object', 'The `post.content` parameter must be an object')
    assert(post.content.body && typeof post.content.body === 'string', 'The `post.content.body` parameter must be a non-empty string')

    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    url = urlToPathname(url)

    var userArchive = dat.library.getArchive(userSession.url)
    await feedCrawler.editPost(userArchive, url, post.content)
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
    url = urlToPathname(url)

    var userArchive = dat.library.getArchive(userSession.url)
    await feedCrawler.deletePost(userArchive, url)
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
 * @returns {string}
 */
function urlToPathname (url) {
  try {
    var urlParsed = new URL(url)
    if (urlParsed.pathname && urlParsed.pathname !== '/') {
      return urlParsed.pathname
    }
  } catch (e) {
    return url
  }
}

function massagePostRecord (post) {
  return {
    url: post.author.url + post.pathname,
    content: {
      body: post.content.body
    },
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
