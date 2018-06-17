/* globals DatArchive */

const {EventTarget, bindEventStream, fromEventStream} = require('./event-target'
const errors = require('beaker-error-constants'

const archivesManifest = require('../manifests/internal/archives'
const bookmarksManifest = require('../manifests/internal/bookmarks'
const historyManifest = require('../manifests/internal/history'
const downloadsManifest = require('../manifests/internal/downloads'
const sitedataManifest = require('../manifests/internal/sitedata'
const beakerBrowserManifest = require('../manifests/internal/browser'

exports.setup = function (rpc) {
  const beaker = {}
  const opts = {timeout: false, errors}

  // internal only
  if (window.location.protocol === 'beaker:') {
    const historyRPC = rpc.importAPI('history', historyManifest, opts)
    const bookmarksRPC = rpc.importAPI('bookmarks', bookmarksManifest, opts)
    const archivesRPC = rpc.importAPI('archives', archivesManifest, opts)
    const downloadsRPC = rpc.importAPI('downloads', downloadsManifest, opts)
    const sitedataRPC = rpc.importAPI('sitedata', sitedataManifest, opts)
    const beakerBrowserRPC = rpc.importAPI('beaker-browser', beakerBrowserManifest, opts)

    // beaker.bookmarks
    beaker.bookmarks = {}
    beaker.bookmarks.getBookmark = bookmarksRPC.getBookmark
    beaker.bookmarks.isBookmarked = bookmarksRPC.isBookmarked
    beaker.bookmarks.bookmarkPublic = bookmarksRPC.bookmarkPublic
    beaker.bookmarks.unbookmarkPublic = bookmarksRPC.unbookmarkPublic
    beaker.bookmarks.listPublicBookmarks = bookmarksRPC.listPublicBookmarks
    beaker.bookmarks.setBookmarkPinned = bookmarksRPC.setBookmarkPinned
    beaker.bookmarks.setBookmarkPinOrder = bookmarksRPC.setBookmarkPinOrder
    beaker.bookmarks.listPinnedBookmarks = bookmarksRPC.listPinnedBookmarks
    beaker.bookmarks.bookmarkPrivate = bookmarksRPC.bookmarkPrivate
    beaker.bookmarks.unbookmarkPrivate = bookmarksRPC.unbookmarkPrivate
    beaker.bookmarks.listPrivateBookmarks = bookmarksRPC.listPrivateBookmarks
    beaker.bookmarks.listBookmarkTags = bookmarksRPC.listBookmarkTags

    // beaker.archives
    beaker.archives = new EventTarget()
    beaker.archives.status = archivesRPC.status
    beaker.archives.add = archivesRPC.add
    beaker.archives.remove = archivesRPC.remove
    beaker.archives.bulkRemove = archivesRPC.bulkRemove
    beaker.archives.delete = archivesRPC.delete
    beaker.archives.list = archivesRPC.list
    beaker.archives.validateLocalSyncPath = archivesRPC.validateLocalSyncPath
    beaker.archives.setLocalSyncPath = archivesRPC.setLocalSyncPath
    beaker.archives.publish = archivesRPC.publish
    beaker.archives.unpublish = archivesRPC.unpublish
    beaker.archives.listPublished = archivesRPC.listPublished
    beaker.archives.countPublished = archivesRPC.countPublished
    beaker.archives.getPublishRecord = archivesRPC.getPublishRecord
    beaker.archives.touch = archivesRPC.touch
    beaker.archives.clearFileCache = archivesRPC.clearFileCache
    beaker.archives.clearGarbage = archivesRPC.clearGarbage
    beaker.archives.clearDnsCache = archivesRPC.clearDnsCache
    beaker.archives.getDebugLog = archivesRPC.getDebugLog
    beaker.archives.createDebugStream = () => fromEventStream(archivesRPC.createDebugStream())
    try {
      bindEventStream(archivesRPC.createEventStream(), beaker.archives)
    } catch (e) {
      // permissions error
    }

    // beaker.history
    beaker.history = {}
    beaker.history.addVisit = historyRPC.addVisit
    beaker.history.getVisitHistory = historyRPC.getVisitHistory
    beaker.history.getMostVisited = historyRPC.getMostVisited
    beaker.history.search = historyRPC.search
    beaker.history.removeVisit = historyRPC.removeVisit
    beaker.history.removeAllVisits = historyRPC.removeAllVisits
    beaker.history.removeVisitsAfter = historyRPC.removeVisitsAfter

    // beaker.downloads
    beaker.downloads = {}
    beaker.downloads.getDownloads = downloadsRPC.getDownloads
    beaker.downloads.pause = downloadsRPC.pause
    beaker.downloads.resume = downloadsRPC.resume
    beaker.downloads.cancel = downloadsRPC.cancel
    beaker.downloads.remove = downloadsRPC.remove
    beaker.downloads.open = downloadsRPC.open
    beaker.downloads.showInFolder = downloadsRPC.showInFolder
    beaker.downloads.createEventsStream = () => fromEventStream(downloadsRPC.createEventsStream())

    // beaker.sitedata
    beaker.sitedata = {}
    beaker.sitedata.get = sitedataRPC.get
    beaker.sitedata.set = sitedataRPC.set
    beaker.sitedata.getPermissions = sitedataRPC.getPermissions
    beaker.sitedata.getAppPermissions = sitedataRPC.getAppPermissions
    beaker.sitedata.getPermission = sitedataRPC.getPermission
    beaker.sitedata.setPermission = sitedataRPC.setPermission
    beaker.sitedata.setAppPermissions = sitedataRPC.setAppPermissions
    beaker.sitedata.clearPermission = sitedataRPC.clearPermission
    beaker.sitedata.clearPermissionAllOrigins = sitedataRPC.clearPermissionAllOrigins

    // beaker.browser
    beaker.browser = {}
    beaker.browser.createEventsStream = () => fromEventStream(beakerBrowserRPC.createEventsStream())
    beaker.browser.getInfo = beakerBrowserRPC.getInfo
    beaker.browser.checkForUpdates = beakerBrowserRPC.checkForUpdates
    beaker.browser.restartBrowser = beakerBrowserRPC.restartBrowser
    beaker.browser.getSetting = beakerBrowserRPC.getSetting
    beaker.browser.getSettings = beakerBrowserRPC.getSettings
    beaker.browser.setSetting = beakerBrowserRPC.setSetting
    beaker.browser.getUserSetupStatus = beakerBrowserRPC.getUserSetupStatus
    beaker.browser.setUserSetupStatus = beakerBrowserRPC.setUserSetupStatus
    beaker.browser.getDefaultLocalPath = beakerBrowserRPC.getDefaultLocalPath
    beaker.browser.setStartPageBackgroundImage = beakerBrowserRPC.setStartPageBackgroundImage
    beaker.browser.getDefaultProtocolSettings = beakerBrowserRPC.getDefaultProtocolSettings
    beaker.browser.setAsDefaultProtocolClient = beakerBrowserRPC.setAsDefaultProtocolClient
    beaker.browser.removeAsDefaultProtocolClient = beakerBrowserRPC.removeAsDefaultProtocolClient
    beaker.browser.fetchBody = beakerBrowserRPC.fetchBody
    beaker.browser.downloadURL = beakerBrowserRPC.downloadURL
    beaker.browser.listBuiltinFavicons = beakerBrowserRPC.listBuiltinFavicons
    beaker.browser.getBuiltinFavicon = beakerBrowserRPC.getBuiltinFavicon
    beaker.browser.setWindowDimensions = beakerBrowserRPC.setWindowDimensions
    beaker.browser.showOpenDialog = beakerBrowserRPC.showOpenDialog
    beaker.browser.showContextMenu = beakerBrowserRPC.showContextMenu
    beaker.browser.openUrl = beakerBrowserRPC.openUrl
    beaker.browser.openFolder = beakerBrowserRPC.openFolder
    beaker.browser.doWebcontentsCmd = beakerBrowserRPC.doWebcontentsCmd
    beaker.browser.doTest = beakerBrowserRPC.doTest
    beaker.browser.closeModal = beakerBrowserRPC.closeModal
  }

  return beaker
}
