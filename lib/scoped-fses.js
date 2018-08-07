const ScopedFS = require('scoped-fs')

// globals
// =

var scopedFSes = {} // map of scoped filesystems, kept in memory to reduce allocations

// exported APIs
// =

exports.get = function (path) {
  if (!(path in scopedFSes)) {
    scopedFSes[path] = new ScopedFS(path)
    scopedFSes[path].isLocalFS = true
  }
  return scopedFSes[path]
}
