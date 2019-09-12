const assert = require('assert')
const Events = require('events')
const logger = require('../logger').child({category: 'filesystem', subcategory: 'users'})
const dat = require('../dat')
const uwg = require('../uwg')
const filesystem = require('./index')
const follows = require('../uwg/follows')
const db = require('../dbs/profile-data-db')
const archivesDb = require('../dbs/archives')

// constants
// =

const CRAWL_TICK_INTERVAL = 5e3
const NUM_SIMULTANEOUS_CRAWLS = 10
const CRAWL_TIMEOUT = 15e3
const LABEL_REGEX = /[a-z0-9-]/i

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 *
 * @typedef {Object} User
 * @prop {number} id
 * @prop {string} label
 * @prop {string} url
 * @prop {DaemonDatArchive} archive
 * @prop {boolean} isDefault
 * @prop {boolean} isTemporary
 * @prop {string} title
 * @prop {string} description
 * @prop {Date} createdAt
 */

// globals
// =

var events = new Events()
var users = []
var nextCrawlUserIndex = 0

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @returns {Promise<User[]>}
 */
exports.setup = async function () {
  // load the current users
  users = await db.all(`SELECT * FROM users`)
  await Promise.all(users.map(async (user) => {
    // old temporary?
    if (user.isTemporary) {
      // delete old temporary user
      logger.info('Deleting temporary user', {details: user.url})
      user.isInvalid = true // let invalid-user-deletion clean up the record
      let key = dat.archives.fromURLToKey(user.url)
      let archive = await dat.archives.getOrLoadArchive(key)
      return
    }

    // massage data
    user.url = normalizeUrl(user.url)
    user.archive = null
    user.isDefault = Boolean(user.isDefault)
    user.createdAt = new Date(user.createdAt)
    logger.info('Loading user', {details: user.url})

    // validate
    try {
      await validateUserUrl(user.url)
    } catch (e) {
      user.isInvalid = true
      return
    }

    // fetch the user archive
    try {
      user.archive = await dat.archives.getOrLoadArchive(user.url)
      user.url = user.archive.url // copy the archive url, which includes the domain if set
      uwg.watchSite(user.archive)
      events.emit('load-user', user)
    } catch (err) {
      logger.error('Failed to load user', {details: {user, err}})
    }

    // ensure file structure
    await ensureDirectory(user, '/.refs')
    await ensureDirectory(user, '/.refs/authored')
  }))

  // remove any invalid users
  var invalids = users.filter(user => user.isInvalid)
  users = users.filter(user => !user.isInvalid)
  invalids.forEach(async (invalidUser) => {
    await db.run(`DELETE FROM users WHERE url = ?`, [invalidUser.url])
  })

  // initiate ticker
  queueTick()

  return users
}

function queueTick () {
  setTimeout(tick, CRAWL_TICK_INTERVAL)
}

/**
 * @returns {Promise<void>}
 */
async function tick () {
  try {
    var user = users[nextCrawlUserIndex]
    nextCrawlUserIndex++
    if (nextCrawlUserIndex >= users.length) nextCrawlUserIndex = 0
    if (!user) return queueTick()

    // assemble the next set of crawl targets
    var crawlTargets = await selectNextCrawlTargets(user)
    logger.verbose(`Indexing ${crawlTargets.length} sites`, {details: {urls: crawlTargets}})

    // trigger the crawls on each
    var activeCrawls = crawlTargets.map(async (crawlTarget) => {
      await Promise.race([
        new Promise((resolve, reject) => setTimeout(() => reject(`Crawl timed out for ${crawlTarget}`), CRAWL_TIMEOUT)),
        (async () => {
          try {
            // load archive
            var wasLoaded = true // TODO
            var archive = await dat.archives.getOrLoadArchive(crawlTarget) // TODO timeout on load

            // run crawl
            await uwg.crawlSite(archive)

            if (!wasLoaded) {
              // unload archive
              // TODO
            }
          } catch (e) {
            // TODO handle?
          }
        })()
      ])
    })

    // await all crawls
    await Promise.all(activeCrawls)
  } catch (e) {
    console.error(e)
    logger.error('Crawler tick errored', {details: e})
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
  return fetchUserInfo(user)
}

/**
 * @param {string} label
 * @return {Promise<User>}
 */
const getByLabel =
exports.getByLabel = async function (label) {
  var user = users.find(user => user.label === label)
  if (!user) return null
  return fetchUserInfo(user)
}

/**
 * @return {Promise<User>}
 */
const getDefault =
exports.getDefault = async function () {
  var user = users.find(user => user.isDefault === true)
  if (!user) return null
  return fetchUserInfo(user)
}

/**
 * @return {string}
 */
const getDefaultUrl =
exports.getDefaultUrl = function () {
  var user = users.find(user => user.isDefault === true)
  if (!user) return null
  return user.url
}

/**
 * @param {string} label
 * @param {string} url
 * @param {boolean} [setDefault=false]
 * @param {boolean} [isTemporary=false]
 * @returns {Promise<User>}
 */
exports.add = async function (label, url, setDefault = false, isTemporary = false) {
  // validate
  validateUserLabel(label)
  await validateUserUrl(url)

  // make sure the user label or URL doesnt already exist
  url = normalizeUrl(url)
  var existingUser = users.find(user => user.url === url)
  if (existingUser) throw new Error('User already exists at that URL')
  existingUser = users.find(user => user.label === label)
  if (existingUser) throw new Error('User already exists at that label')

  // create the new user
  var user = /** @type User */({
    label,
    url,
    archive: null,
    isDefault: setDefault || users.length === 0,
    isTemporary,
    createdAt: new Date()
  })
  logger.verbose('Adding user', {details: user.url})
  await db.run(
    `INSERT INTO users (label, url, isDefault, isTemporary, createdAt) VALUES (?, ?, ?, ?, ?)`,
    [user.label, user.url, Number(user.isDefault), Number(user.isTemporary), Number(user.createdAt)]
  )
  users.push(user)
  await filesystem.addUser(user)

  // fetch the user archive
  user.archive = await dat.archives.getOrLoadArchive(user.url)
  user.url = user.archive.url // copy the archive url, which includes the domain if set
  uwg.watchSite(user.archive)
  events.emit('load-user', user)
  return fetchUserInfo(user)
}

/**
 * @param {string} url
 * @param {Object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.description]
 * @param {string} [opts.label]
 * @param {boolean} [opts.setDefault]
 * @returns {Promise<User>}
 */
exports.edit = async function (url, opts) {
  // validate
  await validateUserUrl(url)
  if ('label' in opts) validateUserLabel(opts.label)

  // make sure the user label or URL doesnt already exist
  url = normalizeUrl(url)
  var existingUser = users.find(user => user.label === opts.label)
  if (existingUser && existingUser.url !== url) throw new Error('User already exists at that label')

  var user = users.find(user => user.url === url)

  // remove old filesystem mount if the label is changing
  if (opts.label && opts.label !== user.label) {
    await filesystem.removeUser(user)
  }

  // update the user
  if (opts.title) user.title = opts.title
  if (opts.description) user.description = opts.title
  if (opts.setDefault) {
    try { users.find(user => user.isDefault).isDefault = false }
    catch (e) { /* ignore, no existing default */ }
    user.isDefault = true
    await db.run(`UPDATE users SET isDefault = 0 WHERE isDefault = 1`)
    await db.run(`UPDATE users SET isDefault = 1 WHERE url = ?`, [user.url])
  }
  if (opts.label) {
    user.label = opts.label
    await db.run(`UPDATE users SET label = ? WHERE url = ?`, [opts.label, user.url])
  }
  await filesystem.addUser(user)
  logger.verbose('Updated user', {details: user.url})

  // fetch the user archive
  user.archive = await dat.archives.getOrLoadArchive(user.url)
  user.url = user.archive.url // copy the archive url, which includes the domain if set
  return fetchUserInfo(user)
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
  logger.verbose('Removing user', {details: user.url})
  await filesystem.removeUser(user)
  users.splice(users.indexOf(user), 1)
  await db.run(`DELETE FROM users WHERE url = ?`, [user.url])
  /* dont await */uwg.unwatchSite(user.archive)
  events.emit('unload-user', user)
}

/**
 * @param {string} url
 * @return {boolean}
 */
const isUser =
exports.isUser = function (url) {
  url = normalizeUrl(url)
  return !!users.find(user => user.url === url)
}

/**
 * @param {string} label
 */
const validateUserLabel =
exports.validateUserLabel = function (label) {
  assert(label && typeof label === 'string', 'Label must be a non-empty string')
  assert(LABEL_REGEX.test(label), 'Labels can only comprise of letters, numbers, and dashes')
}

// internal methods
// =

/**
 * Assembles a list of crawl targets based on the current database state.
 * Depends on NUM_SIMULTANEOUS_CRAWLS.
 *
 * This function will assemble the list using simple priority heuristics. The priorities are currently:
 *
 *  1. Self
 *  2. Followed sites
 *  3. FoaFs
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
  var followedUrls = (await follows.list({authors: user.url})).map(({topic}) => topic.url)
  rows = rows.concat(followedUrls)

  // get sites followed by followed sites
  var foafUrls = (await follows.list({authors: followedUrls})).map(({topic}) => topic.url)
  rows = rows.concat(foafUrls)

  // eleminate duplicates
  rows = Array.from(new Set(rows))

  // assemble into list
  var start = user.crawlSelectorCursor || 0
  if (start > rows.length) start = 0
  var end = start + NUM_SIMULTANEOUS_CRAWLS
  var nextCrawlTargets = rows.slice(start, end)
  var numRemaining = NUM_SIMULTANEOUS_CRAWLS - nextCrawlTargets.length
  if (numRemaining && rows.length >= NUM_SIMULTANEOUS_CRAWLS) {
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
  var meta = await archivesDb.getMeta(user.archive.key)
  return {
    id: user.id,
    label: user.label,
    url: user.archive.url,
    archive: user.archive,
    isDefault: user.isDefault,
    isTemporary: user.isTemporary,
    title: meta.title,
    description: meta.description,
    createdAt: new Date(user.createdAt)
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
  var meta = await archivesDb.getMeta(urlp.hostname)
  if (!meta.isOwner) {
    throw new Error('User dat is not owned by this device')
  }
}

/**
 * @param {User} user
 * @param {string} pathname
 * @returns {Promise<void>}
 */
async function ensureDirectory (user, pathname) {
  try { await user.archive.pda.mkdir(pathname) }
  catch (e) { /* ignore */ }
}
