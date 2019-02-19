const emitStream = require('emit-stream')
const _throttle = require('lodash.throttle')
const logger = require('../logger').category('crawler')
const lock = require('../lib/lock')
const db = require('../dbs/profile-data-db')
const archivesDb = require('../dbs/archives')
const dat = require('../dat')

const {crawlerEvents, toHostname} = require('./util')
const linkFeed = require('./link-feed')
const followgraph = require('./followgraph')
const siteDescriptions = require('./site-descriptions')

// globals
// =

var watches = {}

// exported api
// =

exports.linkFeed = linkFeed
exports.followgraph = followgraph
exports.siteDescriptions = siteDescriptions
const createEventsStream = exports.createEventsStream = () => emitStream(crawlerEvents)

exports.setup = async function () {
  logger.info('Initialized crawler')
}

exports.watchSite = async function (archive) {
  if (typeof archive === 'string') {
    archive = await dat.library.getOrLoadArchive(archive)
  }
  logger.silly('Watching site', {url: archive.url})

  if (!(archive.url in watches)) {
    crawlerEvents.emit('watch', {sourceUrl: archive.url})
    const queueCrawl = _throttle(() => crawlSite(archive), 5e3)

    // watch for file changes
    watches[archive.url] = archive.pda.watch()
    watches[archive.url].on('data', ([event, args]) => {
      // BUG watch is really inconsistent -prf
      logger.debug('MIRACLE ALERT! The crawler watch stream emitted a change event', {url: archive.url, event, args})
      if (event === 'invalidated') {
        queueCrawl()
      }
    })

    // run the first crawl
    crawlSite(archive)
  }
}

exports.unwatchSite = async function (url) {
  // stop watching for file changes
  if (url in watches) {
    logger.silly('Unwatching site', {url})
    crawlerEvents.emit('unwatch', {sourceUrl: url})
    watches[url].close()
    watches[url] = null
  }
}

const crawlSite =
exports.crawlSite = async function (archive) {
  logger.silly('Crawling site', {details: {url: archive.url}})
  crawlerEvents.emit('crawl-start', {sourceUrl: archive.url})
  var release = await lock('crawl:' + archive.url)
  try {
    // get/create crawl source
    var crawlSource = await db.get(`SELECT id, url FROM crawl_sources WHERE url = ?`, [archive.url])
    if (!crawlSource) {
      let res = await db.run(`INSERT INTO crawl_sources (url) VALUES (?)`, [archive.url])
      crawlSource = {id: res.lastID, url: archive.url}
    }

    // crawl individual sources
    await Promise.all([
      linkFeed.crawlSite(archive, crawlSource),
      followgraph.crawlSite(archive, crawlSource),
      siteDescriptions.crawlSite(archive, crawlSource)
    ])
  } catch (err) {
    logger.error('Failed to crawl site', {details: {url: archive.url, err: err.toString()}})
    crawlerEvents.emit('crawl-error', {sourceUrl: archive.url, err: err.toString()})
  } finally {
    crawlerEvents.emit('crawl-finish', {sourceUrl: archive.url})
    release()
  }
}

const getCrawlStates =
exports.getCrawlStates = async function () {
  var rows = await db.all(`
    SELECT
        crawl_sources.url AS url,
        GROUP_CONCAT(crawl_sources_meta.crawlSourceVersion) AS versions,
        GROUP_CONCAT(crawl_sources_meta.crawlDataset) AS datasets,
        MAX(crawl_sources_meta.updatedAt) AS updatedAt
      FROM crawl_sources
      INNER JOIN crawl_sources_meta ON crawl_sources_meta.crawlSourceId = crawl_sources.id
      GROUP BY crawl_sources.id
  `)
  return Promise.all(rows.map(async ({url, versions, datasets, updatedAt}) => {
    var datasetVersions = {}
    versions = versions.split(',')
    datasets = datasets.split(',')
    for (let i = 0; i < datasets.length; i++) {
      datasetVersions[datasets[i]] = Number(versions[i])
    }
    var meta = await archivesDb.getMeta(toHostname(url))
    return {url, title: meta.title, datasetVersions, updatedAt}
  }))
}

const resetSite =
exports.resetSite = async function (url) {
  logger.debug('Resetting site', {details: {url}})
  await db.run(`DELETE FROM crawl_sources WHERE url = ?`, [url])
}

exports.WEBAPI = {
  listSuggestions: require('./search').listSuggestions,
  listSearchResults: require('./search').listSearchResults,
  createEventsStream,
  getCrawlStates,
  crawlSite: async (url) => {
    var archive = await dat.library.getOrLoadArchive(url)
    return crawlSite(archive)
  },
  resetSite
}