const sitedataDb = require('../dbs/sitedata')
const { PermissionsError } = require('beaker-error-constants')

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
  // TODO
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
  var capsStr = 'Read'
  if (caps.includes('write')) capsStr = 'Read, create, and modify'
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