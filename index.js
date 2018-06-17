const {join} = require('path')
const globals = require('./globals')
const {getEnvVar} = require('./lib/env')
const dat = require('./dat')
const dbs = require('./dbs')

module.exports = {
  getEnvVar,
  globals,
  dat,
  dbs,

  setup (opts) {
    for (let k in opts) {
      globals[k] = opts
    }

    // setup databases
    for (let k in dbs) {
      if (dbs[k].setup) {
        dbs[k].setup(opts)
      }
    }

    // setup dat
    dat.library.setup({logfilePath: join(globals.userDataPath, 'dat.log')})
  }
}
