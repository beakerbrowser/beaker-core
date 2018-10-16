const EventEmitter = require('events')
const emitStream = require('emit-stream')

// dat modules
const datLibrary = require('../dat/library')
const watchlistDb = require('../dbs/watchlist')

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
    throw new Error('Failed to load the watchlist')
  }
}

exports.addSite = async function addSite(profileId, url, opts) {
    // validate parameters
  if (!url || typeof url !== 'string') {
    throw new Error('url must be a string')
  }
  if (!opts.description || typeof opts.description !== 'string') {
    throw new Error('description must be a string')
  }
  if (typeof opts.seedWhenResolved !== 'boolean') {
    throw new Error('seedWhenResolved must be a boolean')
  }

  try {
    var site = await watchlistDb.addSite(profileId, url, opts)
    watch(site)
  } catch (err) {
    throw new Error('Failed to add to watchlist')
  }
}

exports.getSites = async function getSites(profileId) {
  return await watchlistDb.getSites(profileId)
}

const updateWatchlist = exports.updateWatchlist = async function (profileId, site, opts) {
  try {
    await watchlistDb.updateWatchlist(profileId, site, opts)
  } catch (err) {
    throw new Error('Failed to update the watchlist')
  }
}

exports.removeSite = async function removeSite(profileId, url) {
  // validate parameters
  if (!url || typeof url !== 'string') {
    throw new Error('url must be a string')
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