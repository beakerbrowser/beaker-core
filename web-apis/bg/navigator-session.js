const globals = require('../../globals')
const assert = require('assert')
const { UserDeniedError } = require('beaker-error-constants')
const users = require('../../users')
const userSiteSessions = require('../../users/site-sessions')
const sessionPerms = require('../../lib/session-perms')

// typedefs
// =

/**
 * @typedef {import('../../users/index').User} User
 * @typedef {import('../../users/site-sessions').UserSiteSession} UserSiteSession
 * 
 * @typedef {Object} NavigatorSessionPublicAPIRecord
 * @prop {Object} profile
 * @prop {string} profile.url
 * @prop {string} profile.title
 * @prop {string} profile.description
 * @prop {Object} permissions
 */

// exported api
// =

module.exports = {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.permissions]
   * @returns {Promise<NavigatorSessionPublicAPIRecord>}
   */
  async request (opts = {}) {
    if (typeof opts !== 'object') {
      throw new Error('First argument must be an object')
    }
    var user = await getUser(this.sender)
    var siteUrl = await sessionPerms.toDatOrigin(this.sender.getURL())

    // prep the perms
    opts.permissions = opts.permissions || {}
    sessionPerms.normalizePerms(opts.permissions)
    var permissions = Object.entries(opts.permissions).map(([id, caps]) => ({
      id,
      caps,
      icon: sessionPerms.getPermIcon(id),
      description: sessionPerms.describePerm(id, caps)
    }))

    // put the perms in a user-friendly ordering
    var permsOrder = [
      'unwalled.garden/api/follows',
      'unwalled.garden/api/posts',
      'unwalled.garden/api/bookmarks',
      'unwalled.garden/api/comments',
      'unwalled.garden/api/reactions',
      'unwalled.garden/api/votes'
    ]
    permissions.sort((a, b) => permsOrder.indexOf(a.id) - permsOrder.indexOf(b.id))

    // run the modal
    try {
      await globals.uiAPI.showModal(this.sender, 'create-user-session', {
        site: {
          url: siteUrl,
        },
        user: {
          url: user.url,
          title: user.title
        },
        permissions
      })
    } catch (e) {
      throw new UserDeniedError()
    }

    // create the session
    return massageSessionRecord(user, await userSiteSessions.create(user.id, siteUrl, opts.permissions))
  },

  /**
   * @returns {Promise<NavigatorSessionPublicAPIRecord>}
   */
  async get () {
    var user = await getUser(this.sender)
    var siteUrl = await sessionPerms.toDatOrigin(this.sender.getURL())
    return massageSessionRecord(user, await userSiteSessions.get(user.id, siteUrl))
  },

  /**
   * @returns {Promise<void>}
   */
  async destroy () {
    var user = await getUser(this.sender)
    var siteUrl = await sessionPerms.toDatOrigin(this.sender.getURL())
    await userSiteSessions.destroy(user.id, siteUrl)
  }
}

// internal methods
// =

async function getUser (sender) {
  var userSession = globals.userSessionAPI.getFor(sender)
  if (!userSession) throw new Error('No active user session')
  return users.get(userSession.url)
}

/**
 * @param {User} user
 * @param {UserSiteSession} record
 * @returns {NavigatorSessionPublicAPIRecord}
 */
function massageSessionRecord (user, record) {
  if (!record) return null
  return {
    profile: {
      url: user.url,
      title: user.title,
      description: user.description
    },
    permissions: record.permissions
  }
}