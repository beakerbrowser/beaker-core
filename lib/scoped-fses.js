const ScopedFS = require('scoped-fs')

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
    scopedFSes[path].isLocalFS = true
  }
  return scopedFSes[path]
}
