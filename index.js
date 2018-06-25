const assert = require('assert')
const {join} = require('path')
const globals = require('./globals')
const {getEnvVar} = require('./lib/env')
const dat = require('./dat')
const dbs = require('./dbs')
const webapis = require('./web-apis/bg')

module.exports = {
  getEnvVar,
  globals,
  dat,
  dbs,

  setup (opts) {
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

    // setup databases
    for (let k in dbs) {
      if (dbs[k].setup) {
        dbs[k].setup(opts)
      }
    }

    // setup dat
    dat.library.setup({logfilePath: join(globals.userDataPath, 'dat.log')})

    // setup web apis
    webapis.setup(opts)
  }
}
