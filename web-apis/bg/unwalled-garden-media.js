const globals = require('../../globals')
const assert = require('assert')
const {URL} = require('url')
const {PermissionsError} = require('beaker-error-constants')
const dat = require('../../dat')
const mediaCrawler = require('../../crawler/media')

// typedefs
// =

/**
 * @typedef {Object} MediaAuthorPublicAPIRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} type
 *
 * @typedef {Object} MediaPublicAPIRecord
 * @prop {string} url
 * @prop {string} subtype
 * @prop {string} href
 * @prop {string} title
 * @prop {string} description
 * @prop {string[]} tags
 * @prop {string} createdAt
 * @prop {string} updatedAt
 * @prop {MediaAuthorPublicAPIRecord} author
 * @prop {string} visibility
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.filters]
   * @param {string|string[]} [opts.filters.authors]
   * @param {string|string[]} [opts.filters.hrefs]
   * @param {string|string[]} [opts.filters.subtypes]
   * @param {string|string[]} [opts.filters.tags]
   * @param {string} [opts.filters.visibility]
   * @param {string} [opts.sortBy]
   * @param {number} [opts.offset=0]
   * @param {number} [opts.limit]
   * @param {boolean} [opts.reverse]
   * @returns {Promise<MediaPublicAPIRecord[]>}
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
      if ('hrefs' in opts.filters) {
        if (Array.isArray(opts.filters.hrefs)) {
          assert(opts.filters.hrefs.every(v => typeof v === 'string'), 'Hrefs filter must be a string or array of strings')
        } else {
          assert(typeof opts.filters.hrefs === 'string', 'Hrefs filter must be a string or array of strings')
        }
      }
      if ('subtypes' in opts.filters) {
        if (Array.isArray(opts.filters.subtypes)) {
          assert(opts.filters.subtypes.every(v => typeof v === 'string'), 'Subtypes filter must be a string or array of strings')
        } else {
          assert(typeof opts.filters.subtypes === 'string', 'Subtypes filter must be a string or array of strings')
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
    var media = await mediaCrawler.list(opts)
    return Promise.all(media.map(massageMediaRecord))
  },

  /**
   * @param {string} url
   * @returns {Promise<MediaPublicAPIRecord>}
   */
  async get (url) {
    await assertPermission(this.sender, 'dangerousAppControl')
    return massageMediaRecord(await mediaCrawler.get(url))
  },

  /**
   * @param {Object} media
   * @param {string} media.subtype
   * @param {string} media.href
   * @param {string} media.title
   * @param {string} media.description
   * @param {string[]} media.tags
   * @param {string} media.visibility
   * @returns {Promise<MediaPublicAPIRecord>}
   */
  async add (media) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var userArchive = getUserArchive(this.sender)

    assert(media && typeof media === 'object', 'The `media` parameter must be a string or object')
    assert(media.subtype && typeof media.subtype === 'string', 'The `media.subtype` parameter must be a non-empty URL string')
    assert(media.href && typeof media.href === 'string', 'The `media.href` parameter must be a non-empty URL string')
    assert(media.title && typeof media.title === 'string', 'The `media.title` parameter must be a non-empty string')
    if ('description' in media) assert(typeof media.description === 'string', 'The `media.description` parameter must be a string')
    if ('tags' in media) assert(media.tags.every(tag => typeof tag === 'string'), 'The `media.tags` parameter must be an array of strings')
    if ('visibility' in media) assert(typeof media.visibility === 'string', 'The `media.visibility` parameter must be "public" or "private"')

    // default values
    if (!media.visibility) {
      media.visibility = 'public'
    }

    var url = await mediaCrawler.add(userArchive, media)
    return massageMediaRecord(await mediaCrawler.get(url))
  },

  /**
   * @param {string} url
   * @param {Object} media
   * @param {string} media.subtype
   * @param {string} media.href
   * @param {string} media.title
   * @param {string} media.description
   * @param {string[]} media.tags
   * @param {string} media.visibility
   * @returns {Promise<MediaPublicAPIRecord>}
   */
  async edit (url, media) {
    await assertPermission(this.sender, 'dangerousAppControl')
    var userArchive = getUserArchive(this.sender)

    assert(url && typeof url === 'string', 'The `url` parameter must be a valid URL')
    assert(media && typeof media === 'object', 'The `media` parameter must be an object')
    if ('subtype' in media) assert(typeof media.subtype === 'string', 'The `media.subtype` parameter must be a URL string')
    if ('href' in media) assert(typeof media.href === 'string', 'The `media.href` parameter must be a URL string')
    if ('title' in media) assert(media.title && typeof media.title === 'string', 'The `media.title` parameter must be a non-empty string')
    if ('description' in media) assert(typeof media.description === 'string', 'The `media.description` parameter must be a string')
    if ('tags' in media) assert(media.tags.every(tag => typeof tag === 'string'), 'The `media.tags` parameter must be an array of strings')
    if ('visibility' in media) assert(typeof media.visibility === 'string', 'The `media.visibility` parameter must be "public" or "private"')

    var filepath = await urlToFilepath(url, userArchive.url)
    await mediaCrawler.edit(userArchive, filepath, media)
    return massageMediaRecord(await mediaCrawler.get(userArchive.url + filepath))
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
    await mediaCrawler.remove(userArchive, filepath)
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
    throw new Error('Unable to edit media on other sites than your own')
  }

  return filepath
}

/**
 * @param {Object} media
 * @returns {MediaPublicAPIRecord}
 */
function massageMediaRecord (media) {
  if (!media) return null
  var url =  media.author.url + media.pathname
  return {
    url,
    subtype: media.subtype,
    href: media.href,
    title: media.title,
    description: media.description,
    tags: media.tags,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
    author: {
      url: media.author.url,
      title: media.author.title,
      description: media.author.description,
      type: media.author.type
    },
    visibility: media.visibility
  }
}
