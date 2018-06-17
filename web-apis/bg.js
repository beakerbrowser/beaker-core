const globals = require('../globals')
const rpc = globals.rpcAPI

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
const downloadsAPI = globals.downloadsWebAPI
const beakerBrowserAPI = globals.browserWebAPI

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
  rpc.exportAPI('archives', archivesManifest, archivesAPI, internalOnly)
  rpc.exportAPI('bookmarks', bookmarksManifest, bookmarksAPI, internalOnly)
  rpc.exportAPI('history', historyManifest, historyAPI, internalOnly)
  rpc.exportAPI('sitedata', sitedataManifest, sitedataAPI, internalOnly)
  rpc.exportAPI('downloads', downloadsManifest, downloadsAPI, internalOnly)
  rpc.exportAPI('beaker-browser', beakerBrowserManifest, beakerBrowserAPI, internalOnly)

  // external apis
  rpc.exportAPI('dat-archive', datArchiveManifest, datArchiveAPI, secureOnly)

  // experimental apis
  rpc.exportAPI('experimental-library', experimentalLibraryManifest, experimentalLibraryAPI, secureOnly)
  rpc.exportAPI('experimental-global-fetch', experimentalGlobalFetchManifest, experimentalGlobalFetchAPI, secureOnly)
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
