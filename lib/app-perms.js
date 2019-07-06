const {URL} = require('url')
const dat = require('../dat')
const sitedataDb = require('../dbs/sitedata')
const globals = require('../globals')
const knex = require('../lib/knex')
const { ucfirst } = require('../lib/strings')
const db = require('../dbs/profile-data-db')
const { PermissionsError } = require('beaker-error-constants')

const getSessionUserId = exports.getSessionUserId = async function (sender) {
  var userSession = globals.userSessionAPI.getFor(sender)
  if (!userSession) throw new Error('No active user session')
  var record = await db.get(knex('users').where({url: userSession.url}))
  return record.id
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
const toDatOrigin = exports.toDatOrigin = async function (url) {
  try {
    var urlParsed = new URL(url)
  } catch (e) {
    throw new Error('Invalid URL: ' + url)
  }
  if (urlParsed.protocol !== 'dat:') throw new Error('Can only install dat applications')
  urlParsed.hostname = await dat.dns.resolveName(urlParsed.hostname)
  return urlParsed.protocol + '//' + urlParsed.hostname
}

/**
 * @param {Object} sender
 * @param {string} perm eg 'unwalled.garden/perm/comments'
 * @param {string} cap eg 'read' or 'write'
 * @returns {Promise<boolean>}
 */
const can = exports.can = async function (sender, perm, cap) {
  if (sender.getURL().startsWith('beaker:')) {
    return true
  }
  return (await sitedataDb.getAppPermission(sender.getURL(), perm)).includes(cap)
}

/**
 * @param {Object} sender
 * @returns {Promise<void>}
 */
const assertInstalled = exports.assertInstalled = async function (sender) {
  if (sender.getURL().startsWith('beaker:')) return
  var userId = await getSessionUserId(sender)
  var record = await db.get(knex('installed_applications').where({userId, url: await toDatOrigin(sender.getURL())}))
  if (!(record && record.enabled != 0)) {
    throw new PermissionsError()
  }
}

/**
 * @param {Object} sender
 * @param {string} perm eg 'unwalled.garden/perm/comments'
 * @param {string} cap eg 'read' or 'write'
 * @returns {Promise<void>}
 */
const assertCan = exports.assertCan = async function (sender, perm, cap) {
  if (sender.getURL().startsWith('beaker:')) return
  await assertInstalled(sender)
  if (!(await can(sender, perm, cap))) {
    throw new PermissionsError()
  }
}

/**
 * @param {string} perm
 * @param {string[]} caps
 * @returns {string}
 */
const describePerm = exports.describePerm = function (perm, caps) {
  var capsStr = ucfirst(caps.join(' and '))
  switch (perm) {
    case 'unwalled.garden/perm/follows':
      if (caps.includes('write')) return 'Follow and unfollow sites'
      return 'See who you are following'
    case 'unwalled.garden/perm/posts':
      if (caps.includes('write')) return 'Post to your feed'
      return `Read posts on your feed`
    case 'unwalled.garden/perm/bookmarks':
      return `${capsStr} bookmarks`
    case 'unwalled.garden/perm/comments':
      return `${capsStr} comments`
    case 'unwalled.garden/perm/discussions':
      return `${capsStr} discussions`
    case 'unwalled.garden/perm/media':
      return `${capsStr} media`
    case 'unwalled.garden/perm/reactions':
      return `${capsStr} reactions`
    case 'unwalled.garden/perm/sitelists':
      return `${capsStr} site-lists`
    case 'unwalled.garden/perm/votes':
      return `${capsStr} votes`
  }
  return false
}