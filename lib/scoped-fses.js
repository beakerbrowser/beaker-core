const ScopedFS = require('scoped-fs')
const pda = require('pauls-dat-api2')

// typedefs
// =

/**
 * TODO- move this into the scoped-fs module
 * @typedef ScopedFS
 * @prop {function(function(string): boolean): void} setFilter
 * @prop {function(string): boolean} _filter
 * @prop {function(string, [Object]): ReadableStream} createReadStream
 * @prop {function(string, ...any): void} readFile
 * @prop {function(string, ...any): (Buffer | string)} readFileSync
 * @prop {function(string, [Object]): WritableStream} createWriteStream
 * @prop {function(string, ...any): void} writeFile
 * @prop {function(string, ...any): void} writeFileSync
 * @prop {function(string, ...any): void} mkdir
 * @prop {function(string, Function): void} access
 * @prop {function(string, Function): void} exists
 * @prop {function(string, Function): void} lstat
 * @prop {function(string, Function): void} stat
 * @prop {function(string, function(any, string[]): void)} readdir
 * @prop {function(string, Function): void} unlink
 * @prop {function(string, Function): void} rmdir
 * @prop {function(string, Function): Object} watch
 * @prop {ScopedFSPDA} pda
 *
 * @typedef {Object} ScopedFSPDA
 * @prop {function(string): Promise<Object>} stat
 * @prop {function(string, Object=): Promise<any>} readFile
 * @prop {function(string, Object=): Promise<Array<Object>>} readdir
 * @prop {function(string): Promise<number>} readSize
 * @prop {function(string, any, Object=): Promise<void>} writeFile
 * @prop {function(string): Promise<void>} mkdir
 * @prop {function(string, string): Promise<void>} copy
 * @prop {function(string, string): Promise<void>} rename
 * @prop {function(string): Promise<void>} unlink
 * @prop {function(string, Object=): Promise<void>} rmdir
 * @prop {function(string=): Promise<void>} download
 * @prop {function(string=): NodeJS.ReadableStream} watch
 * @prop {function(): NodeJS.ReadableStream} createNetworkActivityStream
 * @prop {function(): Promise<Object>} readManifest
 * @prop {function(Object): Promise<void>} writeManifest
 * @prop {function(Object): Promise<void>} updateManifest
 */

// globals
// =

var scopedFSes = {} // map of scoped filesystems, kept in memory to reduce allocations

// exported APIs
// =

/**
 * @param {string} path
 * @returns {ScopedFS}
 */
exports.get = function (path) {
  if (!(path in scopedFSes)) {
    scopedFSes[path] = new ScopedFS(path)
    scopedFSes[path].pda = createScopedFSPDA(scopedFSes[path])
    scopedFSes[path].isLocalFS = true
  }
  return scopedFSes[path]
}

// internal methods
// =

/**
 * Provides a pauls-dat-api2 object for the given scoped fs
 * @param {Object} scopedFS
 * @returns {ScopedFSPDA}
 */
function createScopedFSPDA (scopedFS) {
  var obj = {}
  for (let k in pda) {
    if (typeof pda[k] === 'function') {
      obj[k] = pda[k].bind(pda, scopedFS)
    }
  }
  return obj
}