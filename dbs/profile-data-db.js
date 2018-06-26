const sqlite3 = require('sqlite3')
const path = require('path')
const fs = require('fs')
const {cbPromise} = require('../lib/functions')
const {setupSqliteDB} = require('../lib/db')

// globals
// =

var db
var migrations
var setupPromise

// exported methods
// =

exports.setup = function (opts) {
  // open database
  var dbPath = path.join(opts.userDataPath, 'Profiles')
  db = new sqlite3.Database(dbPath)
  setupPromise = setupSqliteDB(db, {setup: setupDb, migrations}, '[PROFILES]')
}

exports.get = async function (...args) {
  await setupPromise
  return cbPromise(cb => db.get(...args, cb))
}

exports.all = async function (...args) {
  await setupPromise
  return cbPromise(cb => db.all(...args, cb))
}

exports.run = async function (...args) {
  await setupPromise
  return cbPromise(cb => db.run(...args, cb))
}

exports.serialize = function () {
  return db.serialize()
}

exports.parallelize = function () {
  return db.parallelize()
}

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
  migration('profile-data.v19.sql')
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
