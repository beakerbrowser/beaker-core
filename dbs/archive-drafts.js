const db = require('./profile-data-db')
const archivesDb = require('./archives')

// exported api
// =

exports.list = async function (profileId, masterKey) {
  // get draft list
  var records = await db.all(`SELECT draftKey as key, isActive FROM archive_drafts WHERE profileId = ? AND masterKey = ? ORDER BY createdAt`, [profileId, masterKey])
  // fetch full info from archives db
  return Promise.all(records.map(async ({key, isActive}) => {
    var record = await archivesDb.query(profileId, {key, showHidden: true})
    record.isActiveDraft = !!isActive
    return record
  }))
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

exports.getActiveDraft = async function (profileId, masterKey) {
  var record = await db.get(`SELECT draftKey as key FROM archive_drafts WHERE profileId = ? AND masterKey = ? AND isActive = 1`, [profileId, masterKey])
  if (record) return record.key
  return masterKey
}

exports.setActiveDraft = async function (profileId, masterKey, draftKey) {
  await db.run(`UPDATE archive_drafts SET isActive = 0 WHERE profileId = ? AND masterKey = ?`, [profileId, masterKey])
  await db.run(`UPDATE archive_drafts SET isActive = 1 WHERE profileId = ? AND masterKey = ? AND draftKey = ?`, [profileId, masterKey, draftKey])
}
