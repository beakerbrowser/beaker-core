const sqlite3 = require('sqlite3')
const path = require('path')
const {cbPromise} = require('../lib/functions')
const {setupSqliteDB} = require('../lib/db')
const {getEnvVar} = require('../../lib/env')

// globals
// =
var db
var migrations
var setupPromise
var defaultSettings

// exported methods
// =

exports.setup = function (opts) {
  // open database
  var dbPath = path.join(opts.userDataPath, 'Settings')
  db = new sqlite3.Database(dbPath)
  setupPromise = setupSqliteDB(db, {migrations}, '[SETTINGS]')

  defaultSettings = {
    auto_update_enabled: 1,
    custom_start_page: 'blank',
    start_page_background_image: '',
    workspace_default_path: path.join(opts.homePath, 'Sites'),
    default_dat_ignore: '.git\n.dat\nnode_modules\n*.log\n**/.DS_Store\nThumbs.db\n',
    analytics_enabled: 0
  }
}

exports.set = function (key, value) {
  return setupPromise.then(v => cbPromise(cb => {
    db.run(`
      INSERT OR REPLACE
        INTO settings (key, value, ts)
        VALUES (?, ?, ?)
    `, [key, value, Date.now()], cb)
  }))
}

exports.get = function (key) {
  // env variables
  if (key === 'no_welcome_tab') {
    return (getEnvVar('BEAKER_NO_WELCOME_TAB') == 1)
  }
  // stored values
  return setupPromise.then(v => cbPromise(cb => {
    db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
      if (row) { row = row.value }
      if (typeof row === 'undefined') { row = defaultSettings[key] }
      cb(err, row)
    })
  }))
}

exports.getAll = function () {
  return setupPromise.then(v => cbPromise(cb => {
    db.all(`SELECT key, value FROM settings`, (err, rows) => {
      if (err) { return cb(err) }

      var obj = {}
      rows.forEach(row => { obj[row.key] = row.value })
      obj = Object.assign({}, defaultSettings, obj)
      obj.no_welcome_tab = (getEnvVar('BEAKER_NO_WELCOME_TAB') == 1)
      cb(null, obj)
    })
  }))
}

// internal methods
// =

migrations = [
  // version 1
  function (cb) {
    db.exec(`
      CREATE TABLE settings(
        key PRIMARY KEY,
        value,
        ts
      );
      INSERT INTO settings (key, value) VALUES ('auto_update_enabled', 1);
      PRAGMA user_version = 1;
    `, cb)
  },
  // version 2
  function (cb) {
    db.exec(`
      INSERT INTO settings (key, value) VALUES ('start_page_background_image', '');
      PRAGMA user_version = 2
    `, cb)
  }
]
