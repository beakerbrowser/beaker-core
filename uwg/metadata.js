const assert = require('assert')
const {URL} = require('url')
const joinPath = require('path').join
const Events = require('events')
const logger = require('../logger').child({category: 'uwg', dataset: 'metadata'})
const db = require('../dbs/profile-data-db')
const archivesDb = require('../dbs/archives')
const dat = require('../dat')
const uwg = require('./index')
const {PATHS} = require('../lib/const')

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 */

// globals
// =

var events = new Events()

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for site descriptions.
 *
 * @param {DaemonDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise<void>}
 */
exports.crawlSite = async function (archive, crawlSource) {
  logger.silly('Crawling metadata', {details: {url: archive.url}})

  // list all mounted sites we might want to capture the metadata for
  var targets = [{path: '/dat.json', url: archive.url}]
    .concat(await listMounts(archive, PATHS.REFS_AUTHORED_DATS))
    .concat(await listMounts(archive, PATHS.REFS_FOLLOWED_DATS))

  for (let target of targets) {
    // check if the metadata is already captured
    let hasMeta = await archivesDb.hasMeta(target.url)
    if (hasMeta) continue

    // if not, read and store
    try {
      let manifest = await archive.pda.readFile(target.path)
      manifest = JSON.parse(manifest)
      await archivesDb.setMeta(target.url, manifest)
    } catch (e) {
      // ignore
    }
  }

  logger.silly(`Finished crawling metadata`, {details: {url: archive.url}})
}

/**
 * @param {DaemonDatArchive} archive
 * @param {string} containingPath
 * @returns {Promise<Object[]>}
 */
async function listMounts (archive, containingPath) {
  var targets = []
  var names = await archive.pda.readdir(containingPath).catch(e => ([]))
  for (let name of names) {
    let mountPath = joinPath(containingPath, name)
    let st = await archive.pda.stat(mountPath).catch(err => null)
    if (!st || !st.mount) continue
    targets.push({path: joinPath(mountPath, 'dat.json'), url: st.mount.key.toString('hex')})
  }
  return targets
}