const db = require('./profile-data-db')

// typedefs
// =

/**
 * @typedef {Object} Template
 * @prop {string} url
 * @prop {string} title
 * @prop {number} createdAt
 *
 * @typedef {Object} TemplateScreenshot
 * @prop {string} url
 * @prop {string} screenshot
 */

// exported api
// =

/**
 * @param {number} profileId
 * @param {string} url
 * @returns {Promise<Template>}
 */
exports.get = function (profileId, url) {
  return db.get(`SELECT url, title, createdAt FROM templates WHERE profileId = ? AND url = ?`, [profileId, url])
}

/**
 * @param {number} profileId
 * @param {string} url
 * @returns {Promise<TemplateScreenshot>}
 */
exports.getScreenshot = function (profileId, url) {
  return db.get(`SELECT url, screenshot FROM templates WHERE profileId = ? AND url = ?`, [profileId, url])
}

/**
 * @param {number} profileId
 * @returns {Promise<Array<Template>>}
 */
exports.list = function (profileId) {
  return db.all(`SELECT url, title, createdAt FROM templates WHERE profileId = ? ORDER BY title`, [profileId])
}

/**
 * @param {number} profileId
 * @param {string} url
 * @param {Object} values
 * @param {string} values.title
 * @param {string} values.screenshot
 * @returns {Promise<void>}
 */
exports.put = function (profileId, url, {title, screenshot}) {
  return db.run(`
    INSERT OR REPLACE
      INTO templates (profileId, url, title, screenshot)
      VALUES (?, ?, ?, ?)
  `, [profileId, url, title, screenshot])
}

/**
 * @param {number} profileId
 * @param {string} url
 * @returns {Promise<void>}
 */
exports.remove = function (profileId, url) {
  return db.run(`DELETE FROM templates WHERE profileId = ? AND url = ?`, [profileId, url])
}
