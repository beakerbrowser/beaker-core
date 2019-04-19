const Events = require('events')
const ICO = require('icojs')
const mime = require('mime')
const logger = require('../logger').child({category: 'crawler', dataset: 'assets'})
const sitedata = require('../dbs/sitedata')
const {doCrawl, doCheckpoint, getMatchingChangesInOrder, emitProgressEvent} = require('./util')

// constants
// =

const TABLE_VERSION = 1
const ASSET_PATH_REGEX = /^\/(favicon|thumb|cover).(jpg|jpeg|png|ico)$/i
const IDEAL_FAVICON_SIZE = 64

// typedefs
// =

/**
 * @typedef {import('../dat/library').InternalDatArchive} InternalDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 */

// globals
// =

const events = new Events()

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for assets.
 *
 * @param {InternalDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise<void>}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_assets', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling assets', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await doCheckpoint('crawl_assets', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed assets
    var changedAssets = getMatchingChangesInOrder(changes, ASSET_PATH_REGEX)
    if (changedAssets.length) {
      logger.verbose('Collected new/changed assets', {details: {url: archive.url, changedAssets: changedAssets.map(p => p.name)}})
    } else {
      logger.debug('No new assets found', {details: {url: archive.url}})
    }
    emitProgressEvent(archive.url, 'crawl_assets', 0, changedAssets.length)

    // read and cache each asset in order
    var progress = 0
    for (let changedAsset of changedAssets) {
      let assetType = extractAssetType(changedAsset.name)
      if (changedAsset.type === 'del') {
        // delete
        await sitedata.clear(archive.url, assetType)
        events.emit('asset-removed', archive.url)
      } else {
        // read and store
        var dataUrl = await readAsset(archive, changedAsset.name)
        await sitedata.set(archive.url, assetType, dataUrl)
        events.emit('asset-updated', archive.url)
      }

      // checkpoint our progress
      await doCheckpoint('crawl_assets', TABLE_VERSION, crawlSource, changedAsset.version)
      emitProgressEvent(archive.url, 'crawl_assets', ++progress, changedAssets.length)
    }
    logger.silly(`Finished crawling assets`, {details: {url: archive.url}})
  })
}

// internal
// =

/**
 * Extract the asset type from the pathname
 * @param {string} pathname
 * @returns string
 */
function extractAssetType (pathname) {
  if (/cover/.test(pathname)) return 'cover'
  if (/thumb/.test(pathname)) return 'thumb'
  return 'favicon'
}

/**
 * Reads the asset file as a dataurl
 * - Converts any .ico to .png
 * @param {InternalDatArchive} archive
 * @param {string} pathname
 * @returns string The asset as a data URL
 */
async function readAsset (archive, pathname) {
  if (pathname.endsWith('.ico')) {
    let data = await archive.pda.readFile(pathname, 'binary')
    // select the best-fitting size
    let images = await ICO.parse(data, 'image/png')
    let image = images[0]
    for (let i = 1; i < images.length; i++) {
      if (Math.abs(images[i].width - IDEAL_FAVICON_SIZE) < Math.abs(image.width - IDEAL_FAVICON_SIZE)) {
        image = images[i]
      }
    }
    let buf = Buffer.from(image.buffer)
    return `data:image/png;base64,${buf.toString('base64')}`
  } else {
    let data = await archive.pda.readFile(pathname, 'base64')
    return `data:${mime.lookup(pathname)};base64,${data}`
  }
}