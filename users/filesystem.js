const logger = require('../logger').category('filesystem')
const dat = require('../dat')
const db = require('../dbs/profile-data-db')

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 * @typedef {import('./index').User} User
 */

// globals
// =

var rootArchive

// exported api
// =

/**
 * @returns {DaemonDatArchive}
 */
exports.get = () => rootArchive

/**
 * @param {User[]} users
 * @returns {Promise<void>}
 */
exports.setup = async function (users) {
  // create the root archive as needed
  var browsingProfile = await db.get(`SELECT * FROM profiles WHERE id = 0`)
  if (!browsingProfile.url) {
    let url = await dat.library.createNewArchive({}, {
      hidden: true,
      networked: false
    })
    logger.info('Root archive created', {url})
    await db.run(`UPDATE profiles SET url = ? WHERE id = 0`, [url])
    browsingProfile.url = url
  }

  // load root archive
  rootArchive = await dat.library.getOrLoadArchive(browsingProfile.url)

  // enforce root files structure
  logger.info('Loading root archive', {url: browsingProfile.url})
  try {
    await ensureDir('/users')

    // ensure all user mounts are set
    for (let user of users) {
      if (user.isDefault) await ensureMount('/public', user.url)
      if (!user.isTemporary) {
        await ensureMount(`/users/${user.label}`, user.url)
      }
    }

    // clear out any old mounts
    let usersFilenames = await rootArchive.pda.readdir('/users', {stat: true})
    for (let filename of usersFilenames) {
      if (!users.find(u => u.label === filename)) {
        let path = `/users/${filename}`
        let st = await stat(path)
        if (st && st.mount) {
          logger.info('Removing old /users mount', {path})
          await rootArchive.pda.unmount(path)
        }
      }
    }

    // TODO remove /users mounts under old labels
  } catch (e) {
    console.error('Error while constructing the root archive', e)
    logger.error('Error while constructing the root archive', e)
  }
}

/**
 * @param {User} user
 * @returns {Promise<void>}
 */
exports.addUser = async function (user) {
  await ensureMount(`/users/${user.label}`, user.url)
  if (user.isDefault) await ensureMount(`/public`, user.url)
}

/**
 * @param {User} user
 * @returns {Promise<void>}
 */
exports.removeUser = async function (user) {
  await ensureUnmount(`/users/${user.label}`)
}

// internal methods
// =

async function stat (path) {
  try { return await rootArchive.pda.stat(path) }
  catch (e) { return null }
}

async function ensureDir (path) {
  try {
    let st = await stat(path)
    if (!st) {
      logger.info('Creating directory', path)
      await rootArchive.pda.mkdir(path)
    } else if (!st.isDirectory()) {
      logger.error('Warning! Filesystem expects a folder but an unexpected file exists at this location.', {path})
    }
  } catch (e) {
    logger.error('Filesystem failed to make directory', {path, error: e})
  }
}

async function ensureMount (path, url) {
  try {
    let st = await stat(path)
    let key = await dat.library.fromURLToKey(url, true)
    if (!st) {
      // add mount
      logger.info('Adding mount', {path, key})
      await rootArchive.pda.mount(path, key)
    } else if (st.mount) {
      if (st.mount.key.toString('hex') !== key) {
        // change mount
        logger.info('Reassigning mount', {path, key, oldKey: st.mount.key.toString('hex')})
        await rootArchive.pda.unmount(path)
        await rootArchive.pda.mount(path, key)
      }
    } else {
      logger.error('Warning! Filesystem expects a mount but an unexpected file exists at this location.', {path})
    }
  } catch (e) {
    logger.error('Filesystem failed to mount archive', {path, url, error: e})
  }
}

async function ensureUnmount (path) {
  try {
    let st = await stat(path)
    if (st && st.mount) {
      // remove mount
      logger.info('Removing mount', {path})
      await rootArchive.pda.unmount(path)
    }
  } catch (e) {
    logger.error('Filesystem failed to unmount archive', {path, error: e})
  }
}