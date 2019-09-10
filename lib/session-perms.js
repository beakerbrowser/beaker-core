const globals = require('../globals')
const knex = require('./knex')
const users = require('../filesystem/users')
const userSiteSessions = require('../filesystem/site-sessions')
const datArchives = require('../dat/archives')
const { ucfirst } = require('./strings')
const db = require('../dbs/profile-data-db')
const { PermissionsError } = require('beaker-error-constants')

// typedefs
// =

/**
 * @typedef {import('../filesystem/site-sessions').UserSiteSession} UserSiteSession
 */

// exported api
// =

const getSessionUserId = exports.getSessionUserId = async function (sender) {
  var userSession = globals.userSessionAPI.getFor(sender)
  if (!userSession) throw new Error('No active user session')
  return (await users.get(userSession.url)).id
}

exports.getSessionUserArchive = async function (sender) {
  var userSession = globals.userSessionAPI.getFor(sender)
  if (!userSession) throw new Error('No active user session')
  var key = await datArchives.fromURLToKey(userSession.url, true)
  return datArchives.getArchive(key)
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
const toDatOrigin = exports.toDatOrigin = async function (url) {
  if (!url.startsWith('dat://')) throw new Error('Can only create sessions with dat sites')
  return datArchives.getPrimaryUrl(url)
}

/**
 * @param {UserSiteSession} sess
 * @param {string} perm eg 'unwalled.garden/api/comments'
 * @param {string} cap eg 'read' or 'write'
 * @returns {boolean}
 */
const can = exports.can = function (sess, perm, cap) {
  if (cap === 'read') return true // read permissions are all allowed, at this stage, if a session exists
  return (sess.permissions[perm] || []).includes(cap)
}

/**
 * @param {Object} sender
 * @returns {Promise<UserSiteSession>}
 */
const getSessionOrThrow = exports.getSessionOrThrow = async function (sender) {
  if (sender.getURL().startsWith('beaker:')) return
  var userId = await getSessionUserId(sender)
  var session = await userSiteSessions.get(userId, await toDatOrigin(sender.getURL()))
  if (!session) {
    throw new PermissionsError()
  }
  return session
}

/**
 * @param {Object} sender
 * @param {string} perm eg 'unwalled.garden/api/comments'
 * @param {string} cap eg 'read' or 'write'
 * @returns {Promise<void>}
 */
const assertCan = exports.assertCan = async function (sender, perm, cap) {
  if (sender.getURL().startsWith('beaker:')) return
  var sess = await getSessionOrThrow(sender)
  if (!(await can(sess, perm, cap))) {
    throw new PermissionsError()
  }
}

/**
 * @description
 * permissions automatically include read rights
 * this function ensures the structure reflects that correctly
 * @param {Object} perms
 */
exports.normalizePerms = function (perms) {
  const ensureRead = (id) => {
    perms[id] = perms[id] || []
    if (!perms[id].includes('read')) {
      perms[id].unshift('read')
    }
  }
  ensureRead('unwalled.garden/api/follows')
  ensureRead('unwalled.garden/api/posts')
  ensureRead('unwalled.garden/api/bookmarks')
  ensureRead('unwalled.garden/api/comments')
  ensureRead('unwalled.garden/api/reactions')
  ensureRead('unwalled.garden/api/votes')
}

/**
 * @param {string} perm
 * @returns {string}
 */
const getPermIcon = exports.getPermIcon = function (perm) {
  switch (perm) {
    case 'unwalled.garden/api/follows':
      return 'fas fa-rss'
    case 'unwalled.garden/api/statuses':
      return `far fa-comment-alt`
    case 'unwalled.garden/api/bookmarks':
      return `far fa-star`
    case 'unwalled.garden/api/comments':
      return `far fa-comments`
    case 'unwalled.garden/api/reactions':
      return `far fa-smile`
    case 'unwalled.garden/api/votes':
      return `fas fa-vote-yea`
  }
  return ''
}

/**
 * @param {string} perm
 * @param {string[]} caps
 * @returns {string}
 */
const describePerm = exports.describePerm = function (perm, caps) {
  var capsStr = ucfirst(caps.join(' and '))
  switch (perm) {
    case 'unwalled.garden/api/follows':
      return 'Public follows'
    case 'unwalled.garden/api/statuses':
      return `Public status updates`
    case 'unwalled.garden/api/bookmarks':
      return `Public bookmarks`
    case 'unwalled.garden/api/comments':
      return `Public comments`
    case 'unwalled.garden/api/reactions':
      return `Public reaction emojis`
    case 'unwalled.garden/api/votes':
      return `Public votes`
  }
  return ''
}