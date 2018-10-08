const db = require('./profile-data-db')
const archivesDb = require('./archives')

// exported api
// =

exports.list = async function (profileId, masterKey) {
  // get draft list
  var records = await db.all(`SELECT draftKey as key FROM archive_drafts WHERE profileId = ? AND masterKey = ? ORDER BY createdAt`, [profileId, masterKey])
  // fetch full info from archives db
  return Promise.all(records.map(async ({key}) => archivesDb.query(profileId, {key, showHidden: true})))
}

exports.add = function (profileId, masterKey, draftKey) {
  return db.run(`
    INSERT OR REPLACE
      INTO archive_drafts (profileId, masterKey, draftKey)
      VALUES (?, ?, ?)
  `, [profileId, masterKey, draftKey])
}

exports.remove = function (profileId, masterKey, draftKey) {
  return db.run(`DELETE FROM archive_drafts WHERE profileId = ? AND masterKey = ? AND draftKey = ?`, [profileId, masterKey, draftKey])
}

exports.getMaster = async function (profileId, draftKey) {
  var record = await db.get(`SELECT masterKey as key FROM archive_drafts WHERE profileId = ? AND draftKey = ?`, [profileId, draftKey])
  if (record) return record.key
  return draftKey
}