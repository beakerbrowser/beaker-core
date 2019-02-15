const errors = require('beaker-error-constants')
const bookmarksManifest = require('../manifests/external/bookmarks')

exports.setup = function (rpc) {
  const opts = { timeout: false, errors }
  return function (name) {
    if (name === 'bookmarks') {
      return rpc.importAPI('bookmarks', bookmarksManifest, opts)
    }
    throw new Error(`Unknown API: ${name}`)
  }
}