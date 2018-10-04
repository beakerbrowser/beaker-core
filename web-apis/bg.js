const globals = require('../globals')

const SECURE_ORIGIN_REGEX = /^(beaker:|dat:|https:|http:\/\/localhost(\/|:))/i

// internal manifests
const archivesManifest = require('./manifests/internal/archives')
const beakerBrowserManifest = require('./manifests/internal/browser')
const bookmarksManifest = require('./manifests/internal/bookmarks')
const downloadsManifest = require('./manifests/internal/downloads')
const historyManifest = require('./manifests/internal/history')
const sitedataManifest = require('./manifests/internal/sitedata')

// internal apis
const archivesAPI = require('./bg/archives')
const bookmarksAPI = require('./bg/bookmarks')
const historyAPI = require('./bg/history')
const sitedataAPI = require('../dbs/sitedata').WEBAPI

// external manifests
const datArchiveManifest = require('./manifests/external/dat-archive')
const spellcheckManifest = require('./manifests/external/spellcheck')

// external apis
const datArchiveAPI = require('./bg/dat-archive')
const spellcheckAPI = require('./bg/spellcheck')

// experimental manifests
const experimentalCapturePageManifest = require('./manifests/external/experimental/capture-page')
const experimentalDatPeersManifest = require('./manifests/external/experimental/dat-peers')
const experimentalGlobalFetchManifest = require('./manifests/external/experimental/global-fetch')
const experimentalLibraryManifest = require('./manifests/external/experimental/library')

// experimental apis
const experimentalCapturePageAPI = require('./bg/experimental/capture-page')
const experimentalDatPeersAPI = require('./bg/experimental/dat-peers')
const experimentalGlobalFetchAPI = require('./bg/experimental/global-fetch')
const experimentalLibraryAPI = require('./bg/experimental/library')

// exported api
// =

exports.setup = function () {
  // internal apis
  globals.rpcAPI.exportAPI('archives', archivesManifest, archivesAPI, internalOnly)
  globals.rpcAPI.exportAPI('beaker-browser', beakerBrowserManifest, globals.browserWebAPI, internalOnly)
  globals.rpcAPI.exportAPI('bookmarks', bookmarksManifest, bookmarksAPI, internalOnly)
  globals.rpcAPI.exportAPI('downloads', downloadsManifest, globals.downloadsWebAPI, internalOnly)
  globals.rpcAPI.exportAPI('history', historyManifest, historyAPI, internalOnly)
  globals.rpcAPI.exportAPI('sitedata', sitedataManifest, sitedataAPI, internalOnly)

  // external apis
  globals.rpcAPI.exportAPI('dat-archive', datArchiveManifest, datArchiveAPI, secureOnly)
  globals.rpcAPI.exportAPI('spellchecker', spellcheckManifest, spellcheckAPI, secureOnly)

  // experimental apis
  globals.rpcAPI.exportAPI('experimental-capture-page', experimentalCapturePageManifest, experimentalCapturePageAPI, secureOnly)
  globals.rpcAPI.exportAPI('experimental-dat-peers', experimentalDatPeersManifest, experimentalDatPeersAPI, secureOnly)
  globals.rpcAPI.exportAPI('experimental-global-fetch', experimentalGlobalFetchManifest, experimentalGlobalFetchAPI, secureOnly)
  globals.rpcAPI.exportAPI('experimental-library', experimentalLibraryManifest, experimentalLibraryAPI, secureOnly)
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
