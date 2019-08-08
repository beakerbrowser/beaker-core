const db = require('../dbs/profile-data-db')
const knex = require('../lib/knex')
const lock = require('../lib/lock')

// typedefs
// =

/**
 * @typedef {Object} UserSiteSession
 * @prop {number} id
 * @prop {number} userId
 * @prop {string} url
 * @prop {Object} permissions
 * @prop {Date} createdAt
 */

// globals
// =

var sessions = {} // cache of active sessions

// exported api
// =

/**
 * @param {number} userId
 * @param {string} url
 * @param {Object} permissions
 * @returns {Promise<UserSiteSession>}
 */
exports.create = async function (userId, url, permissions) {
  var release = await lock('user-site-sessions')
  try {
    delete sessions[sesskey(userId, url)]
    await db.run(knex('user_site_sessions').where({userId, url}).delete())
    await db.run(knex('user_site_sessions').insert({
      userId,
      url,
      permissionsJson: JSON.stringify(permissions || {}),
      createdAt: Date.now()
    }))
  } finally {
    release()
  }
  return exports.get(userId, url)
}

/**
 * @param {number} userId
 * @param {string} url
 * @returns {Promise<UserSiteSession>}
 */
exports.get = async function (userId, url) {
  var sess = sessions[sesskey(userId, url)]
  if (sess) return sess
  var record = massageRecord(await db.get(knex('user_site_sessions').where({userId, url})))
  if (record) sessions[sesskey(userId, url)] = record
  return record
}

/**
 * @param {number} userId
 * @param {string} url
 * @returns {Promise<void>}
 */
exports.destroy = async function (userId, url) {
  var release = await lock('user-site-sessions')
  try {
    delete sessions[sesskey(userId, url)]
    await db.run(knex('user_site_sessions').where({userId, url}).delete())
  } finally {
    release()
  }
}

// internal methods
// =

/**
 * @param {number} userId
 * @param {string} url
 * @returns {string}
 */
function sesskey (userId, url) {
  return `${userId}|${url}`
}

/**
 * @param {Object} record
 * @returns {UserSiteSession}
 */
function massageRecord (record) {
  if (!record) return null
  return {
    id: record.id,
    userId: record.userId,
    url: record.url,
    permissions: JSON.parse(record.permissionsJson),
    createdAt: new Date(record.createdAt)
  }
}