const assert = require('assert')
const {join} = require('path')
const debugLogger = require('./lib/debug-logger')
const globals = require('./globals')
const {getEnvVar} = require('./lib/env')
const dat = require('./dat')
const dbs = require('./dbs')
const webapis = require('./web-apis/bg')
const spellChecker = require('./web-apis/bg/spell-checker')
const spellCheckerLib = require('./lib/spell-checker')

module.exports = {
  getEnvVar,
  globals,
  dat,
  dbs,
  spellChecker,

  debugLogger: debugLogger.debugLogger,
  getLogFilePath: debugLogger.getLogFilePath,
  getLogFileContent: debugLogger.getLogFileContent,

  async setup (opts) {
    assert(typeof opts.userDataPath === 'string', 'userDataPath must be a string')
    assert(typeof opts.homePath === 'string', 'homePath must be a string')
    assert(typeof opts.templatesPath === 'string', 'templatesPath must be a string')
    assert(!!opts.permsAPI, 'must provide permsAPI')
    assert(!!opts.uiAPI, 'must provide uiAPI')
    assert(!!opts.rpcAPI, 'must provide rpcAPI')
    assert(!!opts.downloadsWebAPI, 'must provide downloadsWebAPI')
    assert(!!opts.browserWebAPI, 'must provide browserWebAPI')

    for (let k in opts) {
      globals[k] = opts[k]
    }

    // initiate log
    debugLogger.setup(join(opts.userDataPath, 'debug.log'))

    // setup databases
    for (let k in dbs) {
      if (dbs[k].setup) {
        dbs[k].setup(opts)
      }
    }

    // setup dat
    await dat.library.setup({logfilePath: join(globals.userDataPath, 'dat.log')})

    // setup watchlist
    await dat.watchlist.setup()

    // setup web apis
    webapis.setup(opts)

    // setup spellchecker
    spellCheckerLib.setup()
  }
}
