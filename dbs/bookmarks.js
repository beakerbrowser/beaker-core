const db = require('./profile-data-db')
const normalizeUrl = require('normalize-url')
const lock = require('../lib/lock')

const NORMALIZE_OPTS = {
  stripFragment: false,
  stripWWW: false,
  removeQueryParameters: false,
  removeTrailingSlash: false
}

// exported methods
// =

exports.bookmark = async function (profileId, url, {title, tags, notes, pinOrder}) {
  tags = tagsToString(tags)
  var release = await lock(`bookmark:${url}`)
  try {
    // read old bookmark and fallback to old values as needed
    var oldBookmark = await db.get(`SELECT url, title, pinned, pinOrder FROM bookmarks WHERE profileId = ? AND url = ?`, [profileId, url])
    oldBookmark = oldBookmark || {}
    const pinned = oldBookmark.pinned ? 1 : 0
    title = typeof title === 'undefined' ? oldBookmark.title : title
    tags = typeof tags === 'undefined' ? oldBookmark.tags : tags
    notes = typeof notes === 'undefined' ? oldBookmark.notes : notes
    pinOrder = typeof pinOrder === 'undefined' ? oldBookmark.pinOrder : pinOrder

    // update record
    return db.run(`
      INSERT OR REPLACE
        INTO bookmarks (profileId, url, title, tags, notes, pinned, pinOrder)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [profileId, url, title, tags, notes, pinned, pinOrder])
  } finally {
    release()
  }
}

exports.unbookmark = function (profileId, url) {
  return db.run(`DELETE FROM bookmarks WHERE profileId = ? AND url = ?`, [profileId, url])
}

exports.setBookmarkPinned = function (profileId, url, pinned) {
  return db.run(`UPDATE bookmarks SET pinned = ? WHERE profileId = ? AND url = ?`, [pinned ? 1 : 0, profileId, url])
}

exports.setBookmarkPinOrder = async function (profileId, urls) {
  var len = urls.length
  await Promise.all(urls.map((url, i) => (
    db.run(`UPDATE bookmarks SET pinOrder = ? WHERE profileId = ? AND url = ?`, [len - i, profileId, url])
  )))
}

exports.getBookmark = async function (profileId, url) {
  return toNewFormat(await db.get(`SELECT url, title, tags, notes, pinned, pinOrder, createdAt FROM bookmarks WHERE profileId = ? AND url = ?`, [profileId, url]))
}

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

exports.listPinnedBookmarks = async function (profileId) {
  var bookmarks = await db.all(`SELECT url, title, tags, notes, pinned, pinOrder, createdAt FROM bookmarks WHERE profileId = ? AND pinned = 1 ORDER BY pinOrder DESC`, [profileId])
  return bookmarks.map(toNewFormat)
}

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

// TEMP
// apply normalization to old bookmarks
// (can probably remove this in 2018 or so)
// -prf
exports.fixOldBookmarks = async function () {
  var bookmarks = await db.all(`SELECT url FROM bookmarks`)
  bookmarks.forEach(b => {
    let newUrl = normalizeUrl(b.url, NORMALIZE_OPTS)
    db.run(`UPDATE bookmarks SET url = ? WHERE url = ?`, [newUrl, b.url])
  })
}

function tagsToString (v) {
  if (Array.isArray(v)) {
    v = v.join(' ')
  }
  return v
}

function toNewFormat (b) {
  if (!b) return b
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
