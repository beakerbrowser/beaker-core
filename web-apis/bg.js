const globals = require('../globals')

const SECURE_ORIGIN_REGEX = /^(beaker:|dat:|https:|http:\/\/localhost(\/|:))/i

// internal manifests
const beakerBrowserManifest = require('./manifests/internal/browser')
const bookmarksManifest = require('./manifests/internal/bookmarks')
const downloadsManifest = require('./manifests/internal/downloads')
const sitedataManifest = require('./manifests/internal/sitedata')
const archivesManifest = require('./manifests/internal/archives')
const historyManifest = require('./manifests/internal/history')

// internal apis
const archivesAPI = require('./bg/archives')
const bookmarksAPI = require('./bg/bookmarks')
const historyAPI = require('./bg/history')
const sitedataAPI = require('../dbs/sitedata').WEBAPI

// external manifests
const datArchiveManifest = require('./manifests/external/dat-archive')

// external apis
const datArchiveAPI = require('./bg/dat-archive')

// experimental manifests
const experimentalLibraryManifest = require('./manifests/external/experimental/library')
const experimentalGlobalFetchManifest = require('./manifests/external/experimental/global-fetch')

// experimental apis
const experimentalLibraryAPI = require('./bg/experimental/library')
const experimentalGlobalFetchAPI = require('./bg/experimental/global-fetch')

// exported api
// =

exports.setup = function () {
  // internal apis
  globals.rpcAPI.exportAPI('archives', archivesManifest, archivesAPI, internalOnly)
  globals.rpcAPI.exportAPI('bookmarks', bookmarksManifest, bookmarksAPI, internalOnly)
  globals.rpcAPI.exportAPI('history', historyManifest, historyAPI, internalOnly)
  globals.rpcAPI.exportAPI('sitedata', sitedataManifest, sitedataAPI, internalOnly)
  globals.rpcAPI.exportAPI('downloads', downloadsManifest, globals.downloadsWebAPI, internalOnly)
  globals.rpcAPI.exportAPI('beaker-browser', beakerBrowserManifest, globals.browserWebAPI, internalOnly)

  // external apis
  globals.rpcAPI.exportAPI('dat-archive', datArchiveManifest, datArchiveAPI, secureOnly)

  // experimental apis
  globals.rpcAPI.exportAPI('experimental-library', experimentalLibraryManifest, experimentalLibraryAPI, secureOnly)
  globals.rpcAPI.exportAPI('experimental-global-fetch', experimentalGlobalFetchManifest, experimentalGlobalFetchAPI, secureOnly)
}

function internalOnly (event, methodName, args) {
  return (event && event.sender && event.sender.getURL().startsWith('beaker:'))
}

function secureOnly (event, methodName, args) {
  if (!(event && event.sender)) {
    return false
  }
  var url = event.sender.getURL()
  return SECURE_ORIGIN_REGEX.test(url)
}
