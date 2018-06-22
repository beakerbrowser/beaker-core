const db = require('./profile-data-db')

// exported api
// =

exports.get = function (profileId, url) {
  return db.get(`SELECT url, title, createdAt FROM templates WHERE profileId = ? AND url = ?`, [profileId, url])
}

exports.getScreenshot = function (profileId, url) {
  return db.get(`SELECT url, screenshot FROM templates WHERE profileId = ? AND url = ?`, [profileId, url])
}

exports.list = function (profileId) {
  return db.all(`SELECT url, title, createdAt FROM templates WHERE profileId = ? ORDER BY title`, [profileId])
}

exports.put = function (profileId, url, {title, screenshot}) {
  return db.run(`
    INSERT OR REPLACE
      INTO templates (profileId, url, title, screenshot)
      VALUES (?, ?, ?, ?)
  `, [profileId, url, title, screenshot])
}

exports.remove = function (profileId, url) {
  return db.run(`DELETE FROM templates WHERE profileId = ? AND url = ?`, [profileId, url])
}
