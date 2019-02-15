const db = require('./profile-data-db')
const {DEFAULT_RELATIVE_DOMAIN_NAMES} = require('../lib/const')

// typedefs
// =

/**
 * @typedef {Object} DomainName
 * @prop {string} name
 * @prop {string} value
 * @prop {number} updatedAt
 * @prop {boolean} isDefault
 */

// exported methods
// =

/**
 * @param {string} name
 * @param {string} value
 * @returns {Promise<void>}
 */
exports.set = async function (name, value) {
  // validate
  const isFQDN = name.includes('.')
  if (isFQDN) {
    throw new Error('You cannot override domains with TLDs. For example, you can set "beaker" but not "beaker.com".')
  }

  // update record
  await db.run(`
    INSERT OR REPLACE
      INTO domain_names (name, value)
      VALUES (?, ?)
  `, [name, value])
}

/**
 * @param {string} name
 * @returns {Promise<void>}
 */
exports.delete = async function (name) {
  await db.run(`DELETE FROM domain_names WHERE name = ?`, [name])
}

/**
 * @param {string} name
 * @returns {Promise<DomainName>}
 */
exports.get = async function (name) {
  var record
  try {
    record = await db.get(`SELECT name, value, updatedAt FROM domain_names WHERE name = ?`, [name])
  } catch (e) {
    console.error('Failed to read domain_name record', e)
  }
  if (record) {
    record.isDefault = false
  } else {
    // fallback to defaults
    if (name in DEFAULT_RELATIVE_DOMAIN_NAMES) {
      record = {
        name,
        value: DEFAULT_RELATIVE_DOMAIN_NAMES[name],
        updatedAt: undefined,
        isDefault: true
      }
    }
  }
  return record
}

/**
 * @returns {Promise<Array<DomainName>>}
 */
exports.list = async function () {
  var records = await db.all(`SELECT name, value, updatedAt FROM domain_names`)

  // merge in defaults
  for (let name in DEFAULT_RELATIVE_DOMAIN_NAMES) {
    if (!records.find(r => r.name === name)) {
      records.push({
        name,
        value: DEFAULT_RELATIVE_DOMAIN_NAMES,
        updatedAt: undefined,
        isDefault: true
      })
    }
  }

  return records
}
