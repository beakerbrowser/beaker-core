const Events = require('events')
const dat = require('../dat')
const crawler = require('../crawler')
const db = require('../dbs/profile-data-db')
const archivesDb = require('../dbs/archives')
const debug = require('../lib/debug-logger').debugLogger('users')

// constants
// =

const SITE_TYPE = 'unwalled.garden/user'

// globals
// =

var events = new Events()
var users

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

exports.setup = async function () {
  // wire up events
  crawler.followgraph.on('follow-added', onFollowAdded)
  crawler.followgraph.on('follow-removed', onFollowRemoved)

  // load the current users
  users = await db.all(`SELECT * FROM users`)
  console.log('users loaded', users)
  users.forEach(async (user) => {
    // massage data
    user.url = normalizeUrl(user.url)
    user.archive = null
    user.isDefault = Boolean(user.isDefault)
    user.createdAt = new Date(user.createdAt)

    // fetch the user archive
    try {
      await validateUserUrl(user.url)
      user.archive = await dat.library.getOrLoadArchive(user.url)
      watchUser(user)
      events.emit('load-user', user)
    } catch (err) {
      debug('Failed to load user', {user, err})
    }
  })
}

exports.list = async function () {
  return Promise.all(users.map(fetchUserInfo))
}

const get =
exports.get = async function (url) {
  url = normalizeUrl(url)
  console.log('getting user', url, users)
  var user = users.find(user => user.url === url)
  if (!user) return null
  return await fetchUserInfo(user)
}

const getDefault =
exports.getDefault = async function () {
  var user = users.find(user => user.isDefault === true)
  if (!user) return null
  return await fetchUserInfo(user)
}

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
  console.log('adding new user', user)
  await db.run(
    `INSERT INTO users (url, isDefault, createdAt) VALUES (?, ?, ?)`,
    [user.url, Number(user.isDefault), user.createdAt]
  )
  users.push(user)

  // fetch the user archive
  user.archive = await dat.library.getOrLoadArchive(user.url)
  watchUser(user)
  events.emit('load-user', user)
}

exports.remove = async function (url) {
  url = normalizeUrl(url)
  // get the user
  var user = await get(url)
  if (!user) return

  // remove the user
  users.splice(users.indexOf(user), 1)
  await db.run(`DELETE FROM users WHERE url = ?`, [user.url])
  unwatchUser(user)
  events.emit('unload-user', user)
}

// internal methods
// =

async function isUser (url) {
  return !!(await get(url))
}

async function watchUser (user) {
  // watch the user
  await crawler.watchSite(user.archive)

  // watch anybody the user follows
  var followUrls = await crawler.followgraph.listFollows(user.url)
  followUrls.forEach(async (followUrl) => {
    try {
      await crawler.watchSite(followUrl)
    } catch (err) {
      debug('Failed to sync followed user', {url: followUrl, err})
    }
  })
}

async function unwatchUser (user) {
  // unwatch anybody the user follows

  // BUG This will cause glitches if there are any shared follows between 2 local users (which is likely)
  //     sites will be unwatched when they shouldn't be
  //     this is temporary and will fix itself when beaker restarts
  //     -prf

  var followUrls = await crawler.followgraph.listFollows(user.url)
  followUrls.forEach(crawler.unwatchSite)

  // unwatch the user
  await crawler.unwatchSite(user.url)
}

async function onFollowAdded (sourceUrl, subjectUrl) {
  if (isUser(sourceUrl)) {
    try {
      await crawler.watchSite(subjectUrl)
    } catch (err) {
      debug('Failed to sync followed user', {url: subjectUrl, err})
    }
  }
}

async function onFollowRemoved (sourceUrl, subjectUrl) {
  if (isUser(sourceUrl)) {
    await crawler.unwatchSite(subjectUrl)
  }
}

async function fetchUserInfo (user) {
  var urlp = new URL(user.url)
  var meta = await archivesDb.getMeta(urlp.hostname)
  return {
    url: normalizeUrl(user.url),
    isDefault: user.isDefault,
    title: meta.title,
    description: meta.description,
    createdAt: user.createdAt
  }
}

function normalizeUrl (url) {
  return url ? url.replace(/(\/)$/, '') : url
}

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
