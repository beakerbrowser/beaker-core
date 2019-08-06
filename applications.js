const sessionPerms = require('./lib/session-perms')
const knex = require('./lib/knex')
const db = require('./dbs/profile-data-db')
const sitedataDb = require('./dbs/sitedata')
const dat = require('./dat')

// typedefs
// =

/**
 * @typedef {Object} ApplicationPermission
 * @prop {string} id
 * @prop {string[]} caps
 * @prop {string} description
 *
 * @typedef {Object} ApplicationState
 * @prop {string} url
 * @prop {ApplicationPermission[]} permissions
 * @prop {boolean} installed
 * @prop {boolean} enabled
 * @prop {string} installedAt
 */

// exported api
// =

/**
 * @param {Object} opts
 * @param {number} opts.userId
 * @param {string} opts.url
 * @returns {Promise<ApplicationState>}
 */
exports.getApplicationState = async function ({userId, url}) {
  url = await dat.library.getPrimaryUrl(url)
  var record = await db.get(knex('installed_applications').where({userId, url}))
  if (record) {
    record.installed = true
  } else {
    record = {
      url,
      installed: false,
      enabled: false,
      installedAt: null
    }
  }
  record.permissions = await sitedataDb.getAppPermissions(record.url)
  return massageAppRecord(record)
}

// internal methods
// =

/**
 * @param {Object} record
 * @returns {ApplicationState}
 */
function massageAppRecord (record) {
  return {
    url: record.url,
    permissions: Object.entries(record.permissions).map(([id, caps]) => ({
      id,
      caps,
      description: sessionPerms.describePerm(id, caps)
    })),
    installed: record.installed,
    enabled: Boolean(record.enabled),
    installedAt: record.createdAt ? (new Date(record.createdAt)).toISOString() : null
  }
}