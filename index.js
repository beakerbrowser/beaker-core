const assert = require('assert')
const {join} = require('path')
const debugLogger = require('./lib/debug-logger')
const globals = require('./globals')
const logger = require('./logger')
const {getEnvVar} = require('./lib/env')
const dat = require('./dat')
const dbs = require('./dbs')
const users = require('./users')
const crawler = require('./crawler')
const webapis = require('./web-apis/bg')
const spellChecker = require('./web-apis/bg/spell-checker')
const spellCheckerLib = require('./lib/spell-checker')

module.exports = {
  getEnvVar,
  globals,
  logger,
  dat,
  dbs,
  crawler,
  users,
  spellChecker,

  debugLogger: debugLogger.debugLogger,
  getLogFilePath: debugLogger.getLogFilePath,
  getLogFileContent: debugLogger.getLogFileContent,

  async setup (opts) {
    assert(typeof opts.userDataPath === 'string', 'userDataPath must be a string')
    assert(typeof opts.homePath === 'string', 'homePath must be a string')
    assert(typeof opts.templatesPath === 'string', 'templatesPath must be a string')
    assert(!!opts.datDaemonProcess, 'must provide datDaemonProcess')
    assert(!!opts.permsAPI, 'must provide permsAPI')
    assert(!!opts.uiAPI, 'must provide uiAPI')
    assert(!!opts.rpcAPI, 'must provide rpcAPI')
    assert(!!opts.downloadsWebAPI, 'must provide downloadsWebAPI')
    assert(!!opts.browserWebAPI, 'must provide browserWebAPI')
    assert(!!opts.userSessionAPI, 'must provide userSessionAPI')

    for (let k in opts) {
      globals[k] = opts[k]
    }

    // initiate log
    logger.setup(join(opts.userDataPath, 'beaker.log'))
    debugLogger.setup(join(opts.userDataPath, 'debug.log'))

    // setup databases
    for (let k in dbs) {
      if (dbs[k].setup) {
        dbs[k].setup(opts)
      }
    }

    // start subsystems
    // (order is important)
    await dat.library.setup(opts)
    await dat.watchlist.setup()
    await crawler.setup()
    await users.setup()
    webapis.setup()
    spellCheckerLib.setup()
  }
}
