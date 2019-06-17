const globals = require('../../globals')
const assert = require('assert')
const {URL} = require('url')
const {PermissionsError} = require('beaker-error-constants')
const dat = require('../../dat')
const postsCrawler = require('../../crawler/posts')

// typedefs
// =

/**
 * @typedef {Object} PostAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 *
 * @typedef {Object} PostPublicAPIRecord
 * @prop {string} url
 * @prop {string} body
 * @prop {string} createdAt
 * @prop {string} updatedAt
 * @prop {PostAuthorPublicAPIRecord} author
 * @prop {string} visibility
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string} [opts.filters.visibility]
   * @param {string} [opts.sortBy]
   * @param {number} [opts.offset=0]
   * @param {number} [opts.limit]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<PostPublicAPIRecord[]>}
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
      if ('visibility' in opts.filters) {
        assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
      }
    }
    var posts = await postsCrawler.list(opts)
    return Promise.all(posts.map(massagePostRecord))
  },

  /**
   * @param {string} url
   * @returns {Promise<PostPublicAPIRecord>}
   */
  async get (url) {
    await assertPermission(this.sender, 'dangerousAppControl')
    return massagePostRecord(await postsCrawler.get(url))
  },

  /**
   * @param {Object|string} post
   * @param {string} post.body
   * @param {string} [post.visibility]
   * @returns {Promise<PostPublicAPIRecord>}
   */
  async add (post) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var userArchive = getUserArchive(this.sender)

    // string usage
    if (typeof post === 'string') {
      post = {body: post}
    }

    assert(post && typeof post === 'object', 'The `post` parameter must be a string or object')
    assert(post.body && typeof post.body === 'string', 'The `post.body` parameter must be a non-empty string')
    if ('visibility' in post) assert(typeof post.visibility === 'string', 'The `post.visibility` parameter must be "public" or "private"')

    // default values
    if (!post.visibility) {
      post.visibility = 'public'
    }

    var url = await postsCrawler.add(userArchive, post)
    return massagePostRecord(await postsCrawler.get(url))
  },

  /**
   * @param {string} url
   * @param {Object|string} post
   * @param {string} post.body
   * @param {string} [post.visibility]
   * @returns {Promise<PostPublicAPIRecord>}
   */
  async edit (url, post) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var userArchive = getUserArchive(this.sender)

    // string usage
    if (typeof post === 'string') {
      post = {body: post}
    }

    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')
    assert(post && typeof post === 'object', 'The `post` parameter must be a string or object')
    if ('body' in post) assert(typeof post.body === 'string', 'The `post.body` parameter must be a non-empty string')
    if ('visibility' in post) assert(typeof post.visibility === 'string', 'The `post.visibility` parameter must be "public" or "private"')

    var filepath = await urlToFilepath(url, userArchive.url)
    await postsCrawler.edit(userArchive, filepath, post)
    return massagePostRecord(await postsCrawler.get(userArchive.url + filepath))
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async remove (url) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var userArchive = getUserArchive(this.sender)

    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')

    var filepath = await urlToFilepath(url, userArchive.url)
    await postsCrawler.remove(userArchive, filepath)
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

/**
 * @param {Object} post
 * @returns {PostPublicAPIRecord}
 */
function massagePostRecord (post) {
  if (!post) return null
  var url =  post.author.url + post.pathname
  return {
    url,
    body: post.body,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    author: {
      url: post.author.url,
      title: post.author.title,
      description: post.author.description,
      type: post.author.type
    },
    visibility: post.visibility
  }
}
