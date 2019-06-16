const globals = require('../globals')

const SECURE_ORIGIN_REGEX = /^(beaker:|dat:|https:|http:\/\/localhost(\/|:))/i

// internal manifests
const loggerManifest = require('./manifests/internal/logger')
const archivesManifest = require('./manifests/internal/archives')
const beakerBrowserManifest = require('./manifests/internal/browser')
const downloadsManifest = require('./manifests/internal/downloads')
const historyManifest = require('./manifests/internal/history')
const sitedataManifest = require('./manifests/internal/sitedata')
const watchlistManifest = require('./manifests/internal/watchlist')
const templatesManifest = require('./manifests/internal/templates')
const crawlerManifest = require('./manifests/internal/crawler')

// internal apis
const loggerAPI = require('../logger').WEBAPI
const archivesAPI = require('./bg/archives')
const historyAPI = require('./bg/history')
const sitedataAPI = require('../dbs/sitedata').WEBAPI
const watchlistAPI = require('./bg/watchlist')
const templatesAPI = require('./bg/templates')
const crawlerAPI = require('../crawler').WEBAPI

// external manifests
const datArchiveManifest = require('./manifests/external/dat-archive')
const spellCheckerManifest = require('./manifests/external/spell-checker')
const bookmarksManifest = require('./manifests/external/bookmarks')
const libraryManifest = require('./manifests/external/library')
const profilesManifest = require('./manifests/external/profiles')
const searchManifest = require('./manifests/external/search')
const commentsManifest = require('./manifests/external/unwalled-garden-comments')
const postsManifest = require('./manifests/external/unwalled-garden-posts')
const followsManifest = require('./manifests/external/unwalled-garden-follows')
const reactionsManifest = require('./manifests/external/unwalled-garden-reactions')

// external apis
const datArchiveAPI = require('./bg/dat-archive')
const spellCheckerAPI = require('./bg/spell-checker')
const bookmarksAPI = require('./bg/bookmarks')
const libraryAPI = require('./bg/library')
const profilesAPI = require('./bg/profiles')
const searchAPI = require('./bg/search')
const commentsAPI = require('./bg/unwalled-garden-comments')
const postsAPI = require('./bg/unwalled-garden-posts')
const followsAPI = require('./bg/unwalled-garden-follows')
const reactionsAPI = require('./bg/unwalled-garden-reactions')

// experimental manifests
const experimentalCapturePageManifest = require('./manifests/external/experimental/capture-page')
const experimentalDatPeersManifest = require('./manifests/external/experimental/dat-peers')
const experimentalGlobalFetchManifest = require('./manifests/external/experimental/global-fetch')

// experimental apis
const experimentalCapturePageAPI = require('./bg/experimental/capture-page')
const experimentalDatPeersAPI = require('./bg/experimental/dat-peers')
const experimentalGlobalFetchAPI = require('./bg/experimental/global-fetch')

// exported api
// =

exports.setup = function () {
  // internal apis
  globals.rpcAPI.exportAPI('logger', loggerManifest, loggerAPI, internalOnly)
  globals.rpcAPI.exportAPI('archives', archivesManifest, archivesAPI, internalOnly)
  globals.rpcAPI.exportAPI('beaker-browser', beakerBrowserManifest, globals.browserWebAPI, internalOnly)
  globals.rpcAPI.exportAPI('downloads', downloadsManifest, globals.downloadsWebAPI, internalOnly)
  globals.rpcAPI.exportAPI('history', historyManifest, historyAPI, internalOnly)
  globals.rpcAPI.exportAPI('sitedata', sitedataManifest, sitedataAPI, internalOnly)
  globals.rpcAPI.exportAPI('watchlist', watchlistManifest, watchlistAPI, internalOnly)
  globals.rpcAPI.exportAPI('templates', templatesManifest, templatesAPI, internalOnly)
  globals.rpcAPI.exportAPI('crawler', crawlerManifest, crawlerAPI, internalOnly)

  // external apis
  globals.rpcAPI.exportAPI('dat-archive', datArchiveManifest, datArchiveAPI, secureOnly)
  globals.rpcAPI.exportAPI('spell-checker', spellCheckerManifest, spellCheckerAPI)
  globals.rpcAPI.exportAPI('bookmarks', bookmarksManifest, bookmarksAPI, secureOnly)
  globals.rpcAPI.exportAPI('library', libraryManifest, libraryAPI, secureOnly)
  globals.rpcAPI.exportAPI('profiles', profilesManifest, profilesAPI, secureOnly)
  globals.rpcAPI.exportAPI('search', searchManifest, searchAPI, secureOnly)
  globals.rpcAPI.exportAPI('unwalled-garden-comments', commentsManifest, commentsAPI, secureOnly)
  globals.rpcAPI.exportAPI('unwalled-garden-posts', postsManifest, postsAPI, secureOnly)
  globals.rpcAPI.exportAPI('unwalled-garden-follows', followsManifest, followsAPI, secureOnly)
  globals.rpcAPI.exportAPI('unwalled-garden-reactions', reactionsManifest, reactionsAPI, secureOnly)

  // experimental apis
  globals.rpcAPI.exportAPI('experimental-capture-page', experimentalCapturePageManifest, experimentalCapturePageAPI, secureOnly)
  globals.rpcAPI.exportAPI('experimental-dat-peers', experimentalDatPeersManifest, experimentalDatPeersAPI, secureOnly)
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
