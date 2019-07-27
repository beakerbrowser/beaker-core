const { EventTarget, bindEventStream, fromEventStream } = require('./event-target')
const errors = require('beaker-error-constants')

const loggerManifest = require('../manifests/internal/logger')
const applicationsManifest = require('../manifests/internal/applications')
const archivesManifest = require('../manifests/internal/archives')
const beakerBrowserManifest = require('../manifests/internal/browser')
const downloadsManifest = require('../manifests/internal/downloads')
const historyManifest = require('../manifests/internal/history')
const sitedataManifest = require('../manifests/internal/sitedata')
const watchlistManifest = require('../manifests/internal/watchlist')
const templatesManifest = require('../manifests/internal/templates')
const crawlerManifest = require('../manifests/internal/crawler')
const usersManifest = require('../manifests/internal/users')

exports.setup = function (rpc) {
  const beaker = {}
  const opts = { timeout: false, errors }

  // internal only
  if (window.location.protocol === 'beaker:') {
    const loggerRPC = rpc.importAPI('logger', loggerManifest, opts)
    const applicationsRPC = rpc.importAPI('applications', applicationsManifest, opts)
    const archivesRPC = rpc.importAPI('archives', archivesManifest, opts)
    const beakerBrowserRPC = rpc.importAPI('beaker-browser', beakerBrowserManifest, opts)
    const downloadsRPC = rpc.importAPI('downloads', downloadsManifest, opts)
    const historyRPC = rpc.importAPI('history', historyManifest, opts)
    const sitedataRPC = rpc.importAPI('sitedata', sitedataManifest, opts)
    const watchlistRPC = rpc.importAPI('watchlist', watchlistManifest, opts)
    const templatesRPC = rpc.importAPI('templates', templatesManifest, opts)
    const crawlerRPC = rpc.importAPI('crawler', crawlerManifest, opts)
    const usersRPC = rpc.importAPI('users', usersManifest, opts)

    // beaker.logger
    beaker.logger = {}
    beaker.logger.stream = (opts) => fromEventStream(loggerRPC.stream(opts))
    beaker.logger.query = loggerRPC.query

    // beaker.applications
    beaker.applications = {}
    beaker.applications.getInfo = applicationsRPC.getInfo
    beaker.applications.install = applicationsRPC.install
    beaker.applications.requestInstall = applicationsRPC.requestInstall
    beaker.applications.list = applicationsRPC.list
    beaker.applications.enable = applicationsRPC.enable
    beaker.applications.disable = applicationsRPC.disable
    beaker.applications.uninstall = applicationsRPC.uninstall

    // beaker.archives
    beaker.archives = new EventTarget()
    beaker.archives.status = archivesRPC.status
    beaker.archives.add = archivesRPC.add
    beaker.archives.setUserSettings = archivesRPC.setUserSettings
    beaker.archives.remove = archivesRPC.remove
    beaker.archives.bulkRemove = archivesRPC.bulkRemove
    beaker.archives.delete = archivesRPC.delete
    beaker.archives.list = archivesRPC.list
    beaker.archives.validateLocalSyncPath = archivesRPC.validateLocalSyncPath
    beaker.archives.setLocalSyncPath = archivesRPC.setLocalSyncPath
    beaker.archives.ensureLocalSyncFinished = archivesRPC.ensureLocalSyncFinished
    beaker.archives.diffLocalSyncPathListing = archivesRPC.diffLocalSyncPathListing
    beaker.archives.diffLocalSyncPathFile = archivesRPC.diffLocalSyncPathFile
    beaker.archives.publishLocalSyncPathListing = archivesRPC.publishLocalSyncPathListing
    beaker.archives.revertLocalSyncPathListing = archivesRPC.revertLocalSyncPathListing
    beaker.archives.getDraftInfo = archivesRPC.getDraftInfo
    beaker.archives.listDrafts = archivesRPC.listDrafts
    beaker.archives.addDraft = archivesRPC.addDraft
    beaker.archives.removeDraft = archivesRPC.removeDraft
    beaker.archives.touch = archivesRPC.touch
    beaker.archives.clearFileCache = archivesRPC.clearFileCache
    beaker.archives.clearGarbage = archivesRPC.clearGarbage
    beaker.archives.clearDnsCache = archivesRPC.clearDnsCache
    beaker.archives.getDebugLog = archivesRPC.getDebugLog
    beaker.archives.createDebugStream = () => fromEventStream(archivesRPC.createDebugStream())
    window.addEventListener('load', () => {
      try {
        bindEventStream(archivesRPC.createEventStream(), beaker.archives)
      } catch (e) {
        // permissions error
      }
    })

    // beaker.browser
    beaker.browser = {}
    beaker.browser.createEventsStream = () => fromEventStream(beakerBrowserRPC.createEventsStream())
    beaker.browser.getInfo = beakerBrowserRPC.getInfo
    beaker.browser.checkForUpdates = beakerBrowserRPC.checkForUpdates
    beaker.browser.restartBrowser = beakerBrowserRPC.restartBrowser
    beaker.browser.getUserSession = beakerBrowserRPC.getUserSession
    beaker.browser.setUserSession = beakerBrowserRPC.setUserSession
    beaker.browser.showEditProfileModal = beakerBrowserRPC.showEditProfileModal
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
    beaker.browser.readFile = beakerBrowserRPC.readFile
    beaker.browser.getResourceContentType = beakerBrowserRPC.getResourceContentType
    beaker.browser.listBuiltinFavicons = beakerBrowserRPC.listBuiltinFavicons
    beaker.browser.getBuiltinFavicon = beakerBrowserRPC.getBuiltinFavicon
    beaker.browser.uploadFavicon = beakerBrowserRPC.uploadFavicon
    beaker.browser.imageToIco = beakerBrowserRPC.imageToIco
    beaker.browser.toggleSidebar = beakerBrowserRPC.toggleSidebar
    beaker.browser.toggleLiveReloading = beakerBrowserRPC.toggleLiveReloading
    beaker.browser.setWindowDimensions = beakerBrowserRPC.setWindowDimensions
    beaker.browser.setWindowDragModeEnabled = beakerBrowserRPC.setWindowDragModeEnabled
    beaker.browser.moveWindow = beakerBrowserRPC.moveWindow
    beaker.browser.maximizeWindow = beakerBrowserRPC.maximizeWindow
    beaker.browser.showOpenDialog = beakerBrowserRPC.showOpenDialog
    beaker.browser.showContextMenu = beakerBrowserRPC.showContextMenu
    beaker.browser.showModal = beakerBrowserRPC.showModal
    beaker.browser.openUrl = beakerBrowserRPC.openUrl
    beaker.browser.gotoUrl = beakerBrowserRPC.gotoUrl
    beaker.browser.openFolder = beakerBrowserRPC.openFolder
    beaker.browser.doWebcontentsCmd = beakerBrowserRPC.doWebcontentsCmd
    beaker.browser.doTest = beakerBrowserRPC.doTest
    beaker.browser.closeModal = beakerBrowserRPC.closeModal

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

    // beaker.history
    beaker.history = {}
    beaker.history.addVisit = historyRPC.addVisit
    beaker.history.getVisitHistory = historyRPC.getVisitHistory
    beaker.history.getMostVisited = historyRPC.getMostVisited
    beaker.history.search = historyRPC.search
    beaker.history.removeVisit = historyRPC.removeVisit
    beaker.history.removeAllVisits = historyRPC.removeAllVisits
    beaker.history.removeVisitsAfter = historyRPC.removeVisitsAfter

    // beaker.sitedata
    beaker.sitedata = {}
    beaker.sitedata.get = sitedataRPC.get
    beaker.sitedata.set = sitedataRPC.set
    beaker.sitedata.getPermissions = sitedataRPC.getPermissions
    beaker.sitedata.getAppPermissions = sitedataRPC.getAppPermissions
    beaker.sitedata.getAppPermission = sitedataRPC.getAppPermission
    beaker.sitedata.getPermission = sitedataRPC.getPermission
    beaker.sitedata.setPermission = sitedataRPC.setPermission
    beaker.sitedata.setAppPermissions = sitedataRPC.setAppPermissions
    beaker.sitedata.clearPermission = sitedataRPC.clearPermission
    beaker.sitedata.clearPermissionAllOrigins = sitedataRPC.clearPermissionAllOrigins

    // beaker.watchlist
    beaker.watchlist = {}
    beaker.watchlist.add = watchlistRPC.add
    beaker.watchlist.list = watchlistRPC.list
    beaker.watchlist.update = watchlistRPC.update
    beaker.watchlist.remove = watchlistRPC.remove
    beaker.watchlist.createEventsStream = () => fromEventStream(watchlistRPC.createEventsStream())

    // beaker.templates
    beaker.templates = {}
    beaker.templates.get = templatesRPC.get
    beaker.templates.list = templatesRPC.list
    beaker.templates.put = templatesRPC.put
    beaker.templates.remove = templatesRPC.remove

    // beaker.crawler
    beaker.crawler = {}
    beaker.crawler.listSuggestions = crawlerRPC.listSuggestions
    beaker.crawler.getCrawlStates = crawlerRPC.getCrawlStates
    beaker.crawler.crawlSite = crawlerRPC.crawlSite
    beaker.crawler.resetSite = crawlerRPC.resetSite
    beaker.crawler.createEventsStream = () => fromEventStream(crawlerRPC.createEventsStream())

    // beaker.users
    beaker.users = {}
    beaker.users.list = usersRPC.list
    beaker.users.get = usersRPC.get
    beaker.users.getCurrent = usersRPC.getCurrent
    beaker.users.getDefault = usersRPC.getDefault
    beaker.users.create = usersRPC.create
    beaker.users.createTemporary = usersRPC.createTemporary
    beaker.users.add = usersRPC.add
    beaker.users.edit = usersRPC.edit
    beaker.users.remove = usersRPC.remove
  }

  return beaker
}
