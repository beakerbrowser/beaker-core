import globals from '../globals'
const rpc = globals.rpcAPI

const SECURE_ORIGIN_REGEX = /^(beaker:|dat:|https:|http:\/\/localhost(\/|:))/i

// internal manifests
import beakerBrowserManifest from './manifests/internal/browser'
import bookmarksManifest from './manifests/internal/bookmarks'
import downloadsManifest from './manifests/internal/downloads'
import sitedataManifest from './manifests/internal/sitedata'
import archivesManifest from './manifests/internal/archives'
import historyManifest from './manifests/internal/history'

// internal apis
import archivesAPI from './bg/archives'
import bookmarksAPI from './bg/bookmarks'
import historyAPI from './bg/history'
import {WEBAPI as sitedataAPI} from '../dbs/sitedata'
const downloadsAPI = globals.downloadsWebAPI
const beakerBrowserAPI = globals.browserWebAPI

// external manifests
import datArchiveManifest from './manifests/external/dat-archive'

// external apis
import datArchiveAPI from './bg/dat-archive'

// experimental manifests
import experimentalLibraryManifest from './manifests/external/experimental/library'
import experimentalGlobalFetchManifest from './manifests/external/experimental/global-fetch'

// experimental apis
import experimentalLibraryAPI from './bg/experimental/library'
import experimentalGlobalFetchAPI from './bg/experimental/global-fetch'

// exported api
// =

export function setup () {
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

