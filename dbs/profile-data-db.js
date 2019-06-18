const sqlite3 = require('sqlite3')
const path = require('path')
const {cbPromise} = require('../lib/functions')
const {setupSqliteDB, handleQueryBuilder} = require('../lib/db')

// typedefs
// =

/**
 * @typedef {Object} SQLiteResult
 * @prop {string} lastID
 */

// globals
// =

var db
var migrations
var setupPromise

// exported methods
// =

/**
 * @param {Object} opts
 * @param {string} opts.userDataPath
 */
exports.setup = function (opts) {
  // open database
  var dbPath = path.join(opts.userDataPath, 'Profiles')
  db = new sqlite3.Database(dbPath)
  setupPromise = setupSqliteDB(db, {setup: setupDb, migrations}, '[PROFILES]')
}

/**
 * @param {...(any)} args
 * @return {Promise<any>}
 */
exports.get = async function (...args) {
  await setupPromise
  args = handleQueryBuilder(args)
  return cbPromise(cb => db.get(...args, cb))
}

/**
 * @param {...(any)} args
 * @return {Promise<Array<any>>}
 */
exports.all = async function (...args) {
  await setupPromise
  args = handleQueryBuilder(args)
  return cbPromise(cb => db.all(...args, cb))
}

/**
 * @param {...(any)} args
 * @return {Promise<SQLiteResult>}
 */
exports.run = async function (...args) {
  await setupPromise
  args = handleQueryBuilder(args)
  return cbPromise(cb => db.run(...args, function (err) {
    if (err) cb(err)
    else cb(null, {lastID: this.lastID})
  }))
}

/**
 * @returns {Promise<void>}
 */
exports.serialize = function () {
  return db.serialize()
}

/**
 * @returns {Promise<void>}
 */
exports.parallelize = function () {
  return db.parallelize()
}

exports.getSqliteInstance = () => db

// internal methods
// =

function setupDb (cb) {
  db.exec(require('./schemas/profile-data.sql'), cb)
}
migrations = [
  migration('profile-data.v1.sql'),
  migration('profile-data.v2.sql'),
  migration('profile-data.v3.sql'),
  migration('profile-data.v4.sql'),
  migration('profile-data.v5.sql'),
  migration('profile-data.v6.sql'),
  migration('profile-data.v7.sql'),
  migration('profile-data.v8.sql'),
  migration('profile-data.v9.sql'),
  migration('profile-data.v10.sql'),
  migration('profile-data.v11.sql'),
  migration('profile-data.v12.sql'),
  migration('profile-data.v13.sql'),
  migration('profile-data.v14.sql'),
  migration('profile-data.v15.sql'),
  migration('profile-data.v16.sql', {canFail: true}), // set canFail because we made a mistake in the rollout of this update, see https://github.com/beakerbrowser/beaker/issues/934
  migration('profile-data.v17.sql'),
  migration('profile-data.v18.sql'),
  migration('profile-data.v19.sql'),
  migration('profile-data.v20.sql'),
  migration('profile-data.v21.sql'),
  migration('profile-data.v22.sql', {canFail: true}), // canFail for the same reason as v16, ffs
  migration('profile-data.v23.sql'),
  migration('profile-data.v24.sql'),
  migration('profile-data.v25.sql'),
  migration('profile-data.v26.sql'),
  migration('profile-data.v27.sql'),
  migration('profile-data.v28.sql'),
  migration('profile-data.v29.sql'),
  migration('profile-data.v30.sql'),
  migration('profile-data.v31.sql'),
  migration('profile-data.v32.sql')
]
function migration (file, opts = {}) {
  return cb => {
    if (opts.canFail) {
      var orgCb = cb
      cb = () => orgCb() // suppress the error
    }
    db.exec(require('./schemas/' + file), cb)
  }
}
