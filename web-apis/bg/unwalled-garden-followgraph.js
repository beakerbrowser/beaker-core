const globals = require('../../globals')
const assert = require('assert')
const {URL} = require('url')
const {PermissionsError} = require('beaker-error-constants')
const dat = require('../../dat')
const followgraphCrawler = require('../../crawler/followgraph')

// typedefs
// =

/**
 * @typedef {Object} FollowgraphSitePublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {Array<string>} type
 */

// exported api
// =

module.exports = {
  /**
   * @param {string} url
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string} [opts.filters.followedBy]
   * @param {number} [opts.offset]
   * @param {number} [opts.limit]
   * @returns {Promise<FollowgraphSitePublicAPIRecord[]>}
   */
  async listFollowers (url, opts) {
    await assertPermission(this.sender, 'dangerousAppControl')

    var query = {}
    url = normalizeFollowUrl(url)
    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')
    if (opts && 'offset' in opts) {
      assert(typeof opts.offset === 'number', 'Offset must be a number')
      query.offset = opts.offset
    }
    if (opts && 'limit' in opts) {
      assert(typeof opts.limit === 'number', 'Limit must be a number')
      query.limit = opts.limit
    }
    if (opts && opts.filters) {
      if ('followedBy' in opts.filters) {
        opts.filters.followedBy = normalizeFollowUrl(opts.filters.followedBy)
        assert(typeof opts.filters.followedBy === 'string', 'Followed-by filter must be a valid URL')
        query.followedBy = opts.filters.followedBy
      }
    }

    query.includeDesc = true
    var followers = await followgraphCrawler.listFollowers(url, opts)
    return followers.map(massageSiteRecord)
  },

  /**
   * @param {string} url
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string} [opts.filters.followedBy]
   * @param {number} [opts.offset]
   * @param {number} [opts.limit]
   * @returns {Promise<FollowgraphSitePublicAPIRecord[]>}
   */
  async listFollows (url, opts) {
    await assertPermission(this.sender, 'dangerousAppControl')

    var query = {}
    url = normalizeFollowUrl(url)
    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')
    if (opts && 'offset' in opts) {
      assert(typeof opts.offset === 'number', 'Offset must be a number')
      query.offset = opts.offset
    }
    if (opts && 'limit' in opts) {
      assert(typeof opts.limit === 'number', 'Limit must be a number')
      query.limit = opts.limit
    }
    if (opts && opts.filters) {
      if ('followedBy' in opts.filters) {
        opts.filters.followedBy = normalizeFollowUrl(opts.filters.followedBy)
        assert(typeof opts.filters.followedBy === 'string', 'Followed-by filter must be a valid URL')
        query.followedBy = opts.filters.followedBy
      }
    }

    query.includeDesc = true
    var follows = await followgraphCrawler.listFollows(url, query)
    console.log(follows, follows.map(massageSiteRecord))
    return follows.map(massageSiteRecord)
  },

  /**
   * @param {string} a
   * @param {string} b
   * @returns {Promise<boolean>}
   */
  async isAFollowingB (a, b) {
    await assertPermission(this.sender, 'dangerousAppControl')

    a = normalizeFollowUrl(a)
    b = normalizeFollowUrl(b)

    assert(a, 'The `a` parameter must be a valid URL')
    assert(b, 'The `b` parameter must be a valid URL')

    return followgraphCrawler.isAFollowingB(a, b)
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async follow (url) {
    await assertPermission(this.sender, 'dangerousAppControl')

    url = normalizeFollowUrl(url)
    assert(url, 'The `url` parameter must be a valid URL')

    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var userArchive = dat.library.getArchive(userSession.url)

    await followgraphCrawler.follow(userArchive, url)
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async unfollow (url) {
    await assertPermission(this.sender, 'dangerousAppControl')

    url = normalizeFollowUrl(url)
    assert(url, 'The `url` parameter must be a valid URL')

    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var userArchive = dat.library.getArchive(userSession.url)

    await followgraphCrawler.unfollow(userArchive, url)
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

function normalizeFollowUrl (url) {
  try {
    url = new URL(url)
    return url.protocol + '//' + url.hostname
  } catch (e) {}
  return null
}

function massageSiteRecord (site) {
  return {
    url: site.url,
    title: site.title,
    description: site.description,
    type: site.type
  }
}
