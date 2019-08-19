const globals = require('../../globals')
const dat = require('../../dat')
const sessionPerms = require('../../lib/session-perms')
const sitedataDb = require('../../dbs/sitedata')
const knex = require('../../lib/knex')
const db = require('../../dbs/profile-data-db')

// typedefs
// =

/**
 * @typedef {import('../../users').User} User
 *
 * @typedef {Object} WebAPIApplicationPermission
 * @prop {string} id
 * @prop {string[]} caps
 * @prop {string} description
 *
 * @typedef {Object} WebAPIApplication
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 * @prop {WebAPIApplicationPermission[]} permissions
 * @prop {boolean} installed
 * @prop {boolean} enabled
 * @prop {string} installedAt
 */

// exported api
// =

module.exports = {
  /**
   * @param {string} url
   * @returns {Promise<WebAPIApplication>}
   */
  async getInfo (url) {
    url = toDatOrigin(url)
    var userId = await sessionPerms.getSessionUserId(this.sender)
    var record = await db.get(knex('installed_applications').where({userId, url}))
    var archiveInfo = await dat.library.getArchiveInfo(url)
    return massageArchiveInfo(archiveInfo, record)
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async install (url) {
    url = toDatOrigin(url)
    var userId = await sessionPerms.getSessionUserId(this.sender)
    var archiveInfo = await dat.library.getArchiveInfo(url)
    var record = await db.get(knex('installed_applications').where({userId, url}))
    if (!record) {
      await db.run(knex('installed_applications').insert({
        userId,
        enabled: 1,
        url,
        createdAt: Date.now()
      }))
    }
    // await sitedataDb.setAppPermissions(url, getArchivePerms(archiveInfo)) DEPRECATED
  },

  /**
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  async requestInstall (url) {
    // run the install modal
    try {
      return globals.uiAPI.showModal(this.sender, 'install-application', {url})
    } catch (e) {
      console.log('ohno', e)
      return false
    }
  },

  /**
   * @returns {Promise<WebAPIApplication[]>}
   */
  async list () {
    var userId = await sessionPerms.getSessionUserId(this.sender)
    var records = await db.all(knex('installed_applications').where({userId}))
    await Promise.all(records.map(async (record) => {
      var archiveInfo = await dat.library.getArchiveInfo(record.url)
      record.title = archiveInfo.title
      record.description = archiveInfo.description
      // record.permissions = await sitedataDb.getAppPermissions(record.url) DEPRECATED
    }))
    return records.map(massageAppRecord)
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async enable (url) {
    url = toDatOrigin(url)
    var userId = await sessionPerms.getSessionUserId(this.sender)
    await db.run(knex('installed_applications').update({enabled: 1}).where({userId, url}))
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async disable (url) {
    url = toDatOrigin(url)
    var userId = await sessionPerms.getSessionUserId(this.sender)
    await db.run(knex('installed_applications').update({enabled: 0}).where({userId, url}))
  },

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async uninstall (url) {
    url = toDatOrigin(url)
    var userId = await sessionPerms.getSessionUserId(this.sender)
    // await sitedataDb.setAppPermissions(url, {}) DEPRECATED
    await db.run(knex('installed_applications').delete().where({userId, url}))
  }
}

// internal methods
// =

function toDatOrigin (url) {
  try {
    var urlParsed = new URL(url)
  } catch (e) {
    throw new Error('Invalid URL: ' + url)
  }
  if (urlParsed.protocol !== 'dat:') throw new Error('Can only install dat applications')
  return `${urlParsed.protocol}//${urlParsed.hostname}`.replace('+preview', '')
}

function getArchivePerms (archiveInfo) {
  try {
    return archiveInfo.manifest.application.permissions
  } catch (e) {
    return []
  }
}

/**
 * @param {Object} archiveInfo
 * @param {Object} record
 * @returns {WebAPIApplication}
 */
function massageArchiveInfo (archiveInfo, record) {
  return {
    url: archiveInfo.url,
    title: archiveInfo.title,
    description: archiveInfo.description,
    permissions: Object.entries(getArchivePerms(archiveInfo)).map(([id, caps]) => ({
      id,
      caps,
      description: sessionPerms.describePerm(id, caps)
    })),
    installed: !!record,
    enabled: Boolean(record && record.enabled),
    installedAt: record ? (new Date(record.createdAt)).toISOString() : null
  }
}

/**
 * @param {Object} record
 * @returns {WebAPIApplication}
 */
function massageAppRecord (record) {
  return {
    url: record.url,
    title: record.title,
    description: record.description,
    permissions: Object.entries(record.permissions).map(([id, caps]) => ({
      id,
      caps,
      description: sessionPerms.describePerm(id, caps)
    })),
    installed: true,
    enabled: Boolean(record.enabled),
    installedAt: (new Date(record.createdAt)).toISOString()
  }
}