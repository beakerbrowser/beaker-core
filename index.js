import globals from './globals'
import {getEnvVar} from './lib/env'
import dat from './dat'
import dbs from './dbs'

export {getEnvVar, globals, dat, dbs}

export function setup (opts) {
  for (var k in opts) {
    globals[k] = opts
  }

  // setup dat
  dat.library.setup({logfilePath: joinPaths(globals.userDataPath, 'dat.log')})
}