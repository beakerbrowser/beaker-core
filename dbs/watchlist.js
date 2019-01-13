const lock = require('../lib/lock')
const db = require('./profile-data-db')

// typedefs
// =

/**
 * @typedef {Object} WatchedSite
 * @prop {number} profileId
 * @prop {string} url
 * @prop {string} description
 * @prop {boolean} seedWhenResolved
 * @prop {boolean} resolved
 * @prop {number} updatedAt
 * @prop {number} createdAt
 */

// exported methods
// =

/**
 * @param {number} profileId
 * @param {string} url
 * @param {Object} opts
 * @param {string} opts.description
 * @param {number} opts.seedWhenResolved
 * @return {Promise<void>}
 */
exports.addSite = async function (profileId, url, opts) {
  var release = await lock('watchlist-db')
  try {
    // get date for timestamp in seconds floored
    var ts = (Date.now() / 1000 | 0)

    // check if site already being watched
    var site = await db.get('SELECT rowid, * from watchlist WHERE profileId = ? AND url = ?', [profileId, url])
    if (!site) {
      // add site to watch list
      await db.run('INSERT INTO watchlist (profileId, url, description, seedWhenResolved, createdAt) VALUES (?, ?, ?, ?, ?);', [profileId, url, opts.description, opts.seedWhenResolved, ts])
    }
  } finally {
    release()
  }
  return db.get('SELECT rowid, * from watchlist WHERE profileId = ? AND url = ?', [profileId, url])
}

/**
 * @param {number} profileId
 * @returns {Promise<Array<WatchedSite>>}
 */
exports.getSites = async function (profileId) {
  return db.all(`SELECT * FROM watchlist WHERE profileId = ?`, [profileId])
}

/**
 * @param {number} profileId
 * @param {WatchedSite} site
 * @returns {Promise<void>}
 */
exports.updateWatchlist = async function (profileId, site) {
  var updatedAt = (Date.now() / 1000 | 0)

  var release = await lock('watchlist-db')
  try {
    await db.run(`UPDATE watchlist SET seedWhenResolved = ?, resolved = ?, updatedAt = ?
    WHERE profileId = ? AND url = ?`, [site.seedWhenResolved, site.resolved, updatedAt, profileId, site.url])
  } finally {
    release()
  }
}

/**
 * @param {number} profileId
 * @param {string} url
 * @return {Promise<void>}
 */
exports.removeSite = async function (profileId, url) {
  return db.run(`DELETE FROM watchlist WHERE profileId = ? AND url = ?`, [profileId, url])
}
