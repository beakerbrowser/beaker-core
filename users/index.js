const Events = require('events')
const logger = require('../logger').category('crawler')
const dat = require('../dat')
const crawler = require('../crawler')
const publishedSites = require('../crawler/published-sites')
const followgraph = require('../crawler/followgraph')
const db = require('../dbs/profile-data-db')
const archivesDb = require('../dbs/archives')

// constants
// =

const SITE_TYPE = 'unwalled.garden/user'
const CRAWL_TICK_INTERVAL = 5e3
const NUM_SIMULTANEOUS_CRAWLS = 10

// typedefs
// =

/**
 * @typedef {import('../dat/library').InternalDatArchive} InternalDatArchive
 *
 * @typedef {Object} User
 * @prop {string} url
 * @prop {InternalDatArchive} archive
 * @prop {boolean} isDefault
 * @prop {string} title
 * @prop {string} description
 * @prop {Date} createdAt
 */

// globals
// =

var events = new Events()
var users

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @returns {Promise<void>}
 */
exports.setup = async function () {
  // initiate ticker
  queueTick()

  // load the current users
  users = await db.all(`SELECT * FROM users`)
  users.forEach(async (user) => {
    // massage data
    user.url = normalizeUrl(user.url)
    user.archive = null
    user.isDefault = Boolean(user.isDefault)
    user.createdAt = new Date(user.createdAt)
    logger.info('Loading user', {details: user})

    // fetch the user archive
    try {
      await validateUserUrl(user.url)
      user.archive = await dat.library.getOrLoadArchive(user.url)
      /* dont await */crawler.watchSite(user.archive)
      events.emit('load-user', user)
    } catch (err) {
      logger.error('Failed to load user', {details: {user, err}})
    }
  })
}

function queueTick () {
  setTimeout(tick, CRAWL_TICK_INTERVAL)
}

/**
 * @returns {Promise<void>}
 */
async function tick () {
  try {
    // TODO handle multiple users
    var user = users[0]
    if (!user) return queueTick()

    // assemble the next set of crawl targets
    var crawlTargets = await selectNextCrawlTargets(user)
    logger.verbose(`Selected ${crawlTargets.length} crawl targets`, {details: {urls: crawlTargets}})

    // trigger the crawls on each
    var activeCrawls = crawlTargets.map(async (crawlTarget) => {
      try {
        // load archive
        var wasLoaded = true // TODO
        var archive = await dat.library.getOrLoadArchive(crawlTarget) // TODO timeout on load

        // run crawl
        await crawler.crawlSite(archive)

        if (!wasLoaded) {
          // unload archive
          // TODO
        }
      } catch (e) {
        // TODO handle?
      }
    })

    // await all crawls
    await Promise.all(activeCrawls)
  } catch (e) {
    logger.error('Crawler tick failed', {details: e})
  }

  // queue next tick
  queueTick()
}

/**
 * @returns {Promise<User[]>}
 */
exports.list = async function () {
  return Promise.all(users.map(fetchUserInfo))
}

/**
 * @param {string} url
 * @return {Promise<User>}
 */
const get =
exports.get = async function (url) {
  url = normalizeUrl(url)
  var user = users.find(user => user.url === url)
  if (!user) return null
  return await fetchUserInfo(user)
}

/**
 * @return {Promise<User>}
 */
const getDefault =
exports.getDefault = async function () {
  var user = users.find(user => user.isDefault === true)
  if (!user) return null
  return await fetchUserInfo(user)
}

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
exports.add = async function (url) {
  // make sure the user doesnt already exist
  url = normalizeUrl(url)
  var existingUser = await get(url)
  if (existingUser) return

  // validate
  await validateUserUrl(url)

  // create the new user
  var user = {
    url,
    archive: null,
    isDefault: users.length === 0,
    createdAt: Date.now()
  }
  logger.verbose('Adding user', {details: user})
  await db.run(
    `INSERT INTO users (url, isDefault, createdAt) VALUES (?, ?, ?)`,
    [user.url, Number(user.isDefault), user.createdAt]
  )
  users.push(user)

  // fetch the user archive
  user.archive = await dat.library.getOrLoadArchive(user.url)
  /* dont await */crawler.watchSite(user.archive)
  events.emit('load-user', user)
}

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
exports.remove = async function (url) {
  url = normalizeUrl(url)
  // get the user
  var user = await get(url)
  if (!user) return

  // remove the user
  logger.verbose('Removing user', {details: user})
  users.splice(users.indexOf(user), 1)
  await db.run(`DELETE FROM users WHERE url = ?`, [user.url])
  /* dont await */crawler.unwatchSite(user.archive)
  events.emit('unload-user', user)
}

// internal methods
// =

/**
 * @param {string} url
 * @return {Promise<boolean>}
 */
async function isUser (url) {
  return !!(await get(url))
}

/**
 * Assembles a list of crawl targets based on the current database state.
 * Depends on NUM_SIMULTANEOUS_CRAWLS.
 *
 * This function will assemble the list using simple priority heuristics. The priorities are currently:
 *
 *  1. Self
 *  2. Followed sites
 *  3. Published sites
 *  4. FoaFs
 *
 * The sites will be ordered by these priorities and then iterated linearly. The ordering within
 * the priority groupings will be according to URL for a deterministic but effectively random ordering.
 *
 * NOTE. The current database state must be queried every time this function is run because the user
 * will follow and unfollow during runtime, which changes the list.
 *
 * @param {Object} user - the user to select crawl-targets for.
 * @returns {Promise<Array<string>>}
 */
async function selectNextCrawlTargets (user) {
  // get self
  var rows = [user.url]

  // get followed sites
  rows = rows.concat(await followgraph.listFollows(user.url))

  // get sites published
  rows = rows.concat(await publishedSites.listPublishedSites(user.url))

  // get sites followed by followed sites
  rows = rows.concat(await followgraph.listFoaFs(user.url))

  // get sites published by followed sites
  // TODO

  // assemble into list
  var start = user.crawlSelectorCursor || 0
  if (start > rows.length) start = 0
  var end = start + NUM_SIMULTANEOUS_CRAWLS
  var nextCrawlTargets = rows.slice(start, end)
  var numRemaining = NUM_SIMULTANEOUS_CRAWLS - nextCrawlTargets.length
  if (numRemaining && rows.length > NUM_SIMULTANEOUS_CRAWLS) {
    // wrap around
    nextCrawlTargets = nextCrawlTargets.concat(rows.slice(0, numRemaining))
    user.crawlSelectorCursor = numRemaining
  } else {
    user.crawlSelectorCursor = end
  }

  return nextCrawlTargets.map(row => typeof row === 'string' ? row : row.url)
}

/**
 * @param {Object} user
 * @returns {Promise<User>}
 */
async function fetchUserInfo (user) {
  var urlp = new URL(user.url)
  var meta = await archivesDb.getMeta(urlp.hostname)
  return {
    url: normalizeUrl(user.url),
    archive: user.archive,
    isDefault: user.isDefault,
    title: meta.title,
    description: meta.description,
    createdAt: user.createdAt
  }
}

/**
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl (url) {
  return url ? url.replace(/(\/)$/, '') : url
}

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
async function validateUserUrl (url) {
  // make sure the archive is saved and that we own the archive
  var urlp = new URL(url)
  var [meta, userSettings] = await Promise.all([
    archivesDb.getMeta(urlp.hostname),
    archivesDb.getUserSettings(0, urlp.hostname)
  ])
  if (!meta.isOwner) {
    throw new Error('User dat is not owned by this device')
  }
  if (!meta.type.includes(SITE_TYPE)) {
    throw new Error('User dat is not the correct type')
  }
  if (!userSettings.isSaved) {
    throw new Error('User dat has been deleted')
  }
}
