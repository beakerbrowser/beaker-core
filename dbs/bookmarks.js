const db = require('./profile-data-db')
const normalizeUrl = require('normalize-url')
const lock = require('../lib/lock')

const NORMALIZE_OPTS = {
  stripFragment: false,
  stripWWW: false,
  removeTrailingSlash: false
}

// typedefs
// =

/**
 * @typedef {Object} Bookmark
 * @prop {boolean} _origin
 * @prop {boolean} _url
 * @prop {boolean} private
 * @prop {number} createdAt
 * @prop {string} href
 * @prop {string} title
 * @prop {string[]} tags
 * @prop {string} notes
 * @prop {boolean} pinned
 * @prop {number} pinOrder
 */

// exported methods
// =

/**
 * @param {number} profileId
 * @param {string} url
 * @param {Object} values
 * @param {string} values.title
 * @param {string | string[]} values.tags
 * @param {string} values.notes
 * @param {number} values.pinOrder
 * @returns {Promise<void>}
 */
exports.bookmark = async function (profileId, url, {title, tags, notes, pinOrder}) {
  var tagsStr = tagsToString(tags)
  var release = await lock(`bookmark:${url}`)
  try {
    // read old bookmark and fallback to old values as needed
    var oldBookmark = await db.get(`SELECT url, title, pinned, pinOrder FROM bookmarks WHERE profileId = ? AND url = ?`, [profileId, url])
    oldBookmark = oldBookmark || {}
    const pinned = oldBookmark.pinned ? 1 : 0
    title = typeof title === 'undefined' ? oldBookmark.title : title
    tagsStr = typeof tagsStr === 'undefined' ? oldBookmark.tags : tagsStr
    notes = typeof notes === 'undefined' ? oldBookmark.notes : notes
    pinOrder = typeof pinOrder === 'undefined' ? oldBookmark.pinOrder : pinOrder

    // update record
    await db.run(`
      INSERT OR REPLACE
        INTO bookmarks (profileId, url, title, tags, notes, pinned, pinOrder)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [profileId, url, title, tagsStr, notes, pinned, pinOrder])
  } finally {
    release()
  }
}

/**
 * @param {number} profileId
 * @param {string} url
 * @returns {Promise<void>}
 */
exports.unbookmark = async function (profileId, url) {
  await db.run(`DELETE FROM bookmarks WHERE profileId = ? AND url = ?`, [profileId, url])
}

/**
 * @param {number} profileId
 * @param {string} url
 * @param {boolean} pinned
 * @returns {Promise<void>}
 */
exports.setBookmarkPinned = async function (profileId, url, pinned) {
  await db.run(`UPDATE bookmarks SET pinned = ? WHERE profileId = ? AND url = ?`, [pinned ? 1 : 0, profileId, url])
}

/**
 * @param {number} profileId
 * @param {string[]} urls
 * @returns {Promise<void>}
 */
exports.setBookmarkPinOrder = async function (profileId, urls) {
  var len = urls.length
  await Promise.all(urls.map((url, i) => (
    db.run(`UPDATE bookmarks SET pinOrder = ? WHERE profileId = ? AND url = ?`, [len - i, profileId, url])
  )))
}

/**
 * @param {number} profileId
 * @param {string} url
 * @returns {Promise<Bookmark>}
 */
exports.getBookmark = async function (profileId, url) {
  return toNewFormat(await db.get(`SELECT url, title, tags, notes, pinned, pinOrder, createdAt FROM bookmarks WHERE profileId = ? AND url = ?`, [profileId, url]))
}

/**
 * @param {number} profileId
 * @param {Object} [opts]
 * @param {string} [opts.tag]
 * @returns {Promise<Array<Bookmark>>}
 */
exports.listBookmarks = async function (profileId, {tag} = {}) {
  var bookmarks = await db.all(`SELECT url, title, tags, notes, pinned, pinOrder, createdAt FROM bookmarks WHERE profileId = ? ORDER BY createdAt DESC`, [profileId])
  bookmarks = bookmarks.map(toNewFormat)

  // apply tag filter
  if (tag) {
    if (Array.isArray(tag)) {
      bookmarks = bookmarks.filter(b => {
        return tag.reduce((agg, t) => agg & b.tags.includes(t), true)
      })
    } else {
      bookmarks = bookmarks.filter(b => b.tags.includes(tag))
    }
  }

  return bookmarks
}

/**
 * @param {number} profileId
 * @returns {Promise<Array<Bookmark>>}
 */
exports.listPinnedBookmarks = async function (profileId) {
  var bookmarks = await db.all(`SELECT url, title, tags, notes, pinned, pinOrder, createdAt FROM bookmarks WHERE profileId = ? AND pinned = 1 ORDER BY pinOrder DESC`, [profileId])
  return bookmarks.map(toNewFormat)
}

/**
 * @param {number} profileId
 * @returns {Promise<Array<string>>}
 */
exports.listBookmarkTags = async function (profileId) {
  var tagSet = new Set()
  var bookmarks = await db.all(`SELECT tags FROM bookmarks WHERE profileId = ?`, [profileId])
  bookmarks.forEach(b => {
    if (b.tags) {
      b.tags.split(' ').forEach(t => tagSet.add(t))
    }
  })
  return Array.from(tagSet)
}

/**
 * @description
 * TEMP
 * apply normalization to old bookmarks
 * (can probably remove this in 2018 or so)
 * -prf
 * @returns {Promise<void>}
 */
exports.fixOldBookmarks = async function () {
  var bookmarks = await db.all(`SELECT url FROM bookmarks`)
  bookmarks.forEach(b => {
    let newUrl = normalizeUrl(b.url, NORMALIZE_OPTS)
    db.run(`UPDATE bookmarks SET url = ? WHERE url = ?`, [newUrl, b.url])
  })
}

/**
 * @param {string | string[]} v
 * @returns {string}
 */
function tagsToString (v) {
  if (Array.isArray(v)) {
    v = v.join(' ')
  }
  return v
}

/**
 * @param {Object} b
 * @returns {Bookmark | null}
 */
function toNewFormat (b) {
  if (!b) return null
  return {
    _origin: false,
    _url: false,
    private: true,
    createdAt: b.createdAt * 1e3, // convert to ms
    href: b.url,
    title: b.title,
    tags: b.tags ? b.tags.split(' ').filter(Boolean) : [],
    notes: b.notes,
    pinned: !!b.pinned,
    pinOrder: b.pinOrder
  }
}
