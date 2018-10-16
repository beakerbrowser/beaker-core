const EventEmitter = require('events')
const emitStream = require('emit-stream')

// dat modules
const archivesDb = require('../dbs/archives')
const datLibrary = require('../dat/library')
const watchlistDb = require('../dbs/watchlist')

class BadParamError extends Error {
  constructor (msg) {
    super()
    this.name = 'BadParamError'
    this.message = msg
  }
}

// globals
// =

var watchlistEvents = new EventEmitter()

// exported methods
// =

exports.setup = async function setup () {
  try {
    var watchedSites = await watchlistDb.getSites(0)
    for (let site of watchedSites) {
      watch(site)
    }
  } catch (err) {
    console.error('Failed to load the watchlist', err)
    throw 'Failed to load the watchlist'
  }
}

exports.addSite = async function addSite(profileId, url, opts) {
    // validate parameters
  if (!url || typeof url !== 'string') {
    throw new BadParamError('url must be a string')
  }
  if (!opts.description || typeof opts.description !== 'string') {
    throw new BadParamError('description must be a string')
  }
  if (typeof opts.seedWhenResolved !== 'boolean') {
    throw new BadParamError('seedWhenResolved must be a boolean')
  }

  try {
    var site = await watchlistDb.addSite(profileId, url, opts)
    watch(site)
  } catch (err) {
    console.error('Failed to add to watchlist', err)
    throw 'Failed to add to watchlist'
  }
}

exports.getSites = async function getSites(profileId) {
  return await watchlistDb.getSites(profileId)
}

const updateWatchlist = exports.updateWatchlist = async function (profileId, site, opts) {
  try {
    await watchlistDb.updateWatchlist(profileId, site, opts)

    // check if site is even resolved before changing seeding
    if (!site.resolved) return

    // toggle seeding
    var key = datLibrary.fromURLToKey(site.url)
    var archive = await datLibrary.getOrLoadArchive(key)
    await datLibrary.pullLatestArchiveMeta(archive)
    var siteSettings = await archivesDb.getUserSettings(0, key)

    if (site.seedWhenResolved && !siteSettings.isSaved) {
      await archivesDb.setUserSettings(0, key, {isSaved: true})
    }
    else if (!site.seedWhenResolved && siteSettings.isSaved) {
      await archivesDb.setUserSettings(0, key, {isSaved: false})
    }
    watchlistEvents.emit('updated', site)
  } catch (err) {
    console.error('Failed to update the watchlist', err)
    throw 'Failed to update the watchlist'
  }
}

exports.removeSite = async function removeSite(profileId, url) {
  // validate parameters
  if (!url || typeof url !== 'string') {
    throw new BadParamError('url must be a string')
  }
  return await watchlistDb.removeSite(profileId, url)
}

// events

exports.createEventsStream = function createEventsStream () {
  return emitStream(watchlistEvents)
}

// internal methods
// =

async function watch (site) {
  await datLibrary.loadArchive(site.url)
  if (site.resolved === 0) {
    watchlistEvents.emit('resolved', site)
  }
  await updateWatchlist(0, site, {resolved: 1})
}