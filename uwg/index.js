const emitStream = require('emit-stream')
const _throttle = require('lodash.throttle')
const logger = require('../logger').category('uwg')
const lock = require('../lib/lock')
const knex = require('../lib/knex')
const db = require('../dbs/profile-data-db')
const archivesDb = require('../dbs/archives')
const dat = require('../dat')

const {uwgEvents, toHostname} = require('./util')
const metadata = require('./metadata')
const bookmarks = require('./bookmarks')
const comments = require('./comments')
const follows = require('./follows')
const dats = require('./dats')
const statuses = require('./statuses')
const reactions = require('./reactions')
const votes = require('./votes')

// globals
// =

var watches = {}

// exported api
// =

exports.bookmarks = bookmarks
exports.comments = comments
exports.follows = follows
exports.dats = dats
exports.statuses = statuses
exports.reactions = reactions
exports.votes = votes
const createEventsStream = exports.createEventsStream = () => emitStream(uwgEvents)

exports.setup = async function () {
  logger.info('Initialized crawler')
}

exports.watchSite = async function (archive) {
  if (typeof archive === 'string') {
    archive = await dat.archives.getOrLoadArchive(archive)
  }
  logger.silly('Watching site', {url: archive.url})

  if (!(archive.url in watches)) {
    uwgEvents.emit('watch', {sourceUrl: archive.url})
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
  url = await dat.archives.getPrimaryUrl(url)
  if (url in watches) {
    logger.silly('Unwatching site', {url})
    uwgEvents.emit('unwatch', {sourceUrl: url})
    watches[url].close()
    watches[url] = null
  }
}

const crawlSite =
exports.crawlSite = async function (archive) {
  if (typeof archive === 'string') {
    archive = await dat.archives.getOrLoadArchive(archive)
  }
  logger.silly('Crawling site', {details: {url: archive.url}})
  uwgEvents.emit('crawl-start', {sourceUrl: archive.url})
  var release = await lock('crawl:' + archive.url)
  try {
    var url = archive.url

    // fetch current dns record
    var datDnsRecord = null
    if (archive.domain) {
      datDnsRecord = await db.get(knex('dat_dns').where({name: archive.domain, isCurrent: 1}))
    }

    // get/create crawl source
    var crawlSource = await db.get(`SELECT id, url, datDnsId FROM crawl_sources WHERE url = ?`, [url])
    if (!crawlSource) {
      let isPrivate = require('../filesystem/index').isRootUrl(url)
      let res = await db.run(knex('crawl_sources').insert({
        url,
        datDnsId: datDnsRecord ? datDnsRecord.id : undefined,
        isPrivate: isPrivate ? 1 : 0
      }))
      crawlSource = {id: res.lastID, url, datDnsId: datDnsRecord ? datDnsRecord.id : undefined, isPrivate}
    }
    crawlSource.globalResetRequired = false

    // check for dns changes
    var didDnsChange = datDnsRecord && crawlSource.datDnsId !== datDnsRecord.id
    if (didDnsChange) {
      crawlSource.globalResetRequired = true
      logger.verbose('Site DNS change detected, recrawling site', {details: {url: archive.url}})
      uwgEvents.emit('crawl-dns-change', {sourceUrl: archive.url})
    }

    // crawl individual sources
    await Promise.all([
      metadata.crawlSite(archive, crawlSource),
      bookmarks.crawlSite(archive, crawlSource),
      comments.crawlSite(archive, crawlSource),
      follows.crawlSite(archive, crawlSource),
      dats.crawlSite(archive, crawlSource),
      statuses.crawlSite(archive, crawlSource),
      reactions.crawlSite(archive, crawlSource),
      votes.crawlSite(archive, crawlSource)
    ])

    // update dns tracking
    if (didDnsChange) {
      await db.run(
        knex('crawl_sources')
          .update({datDnsId: datDnsRecord.id})
          .where({id: crawlSource.id})
      )
    }
  } catch (err) {
    logger.error('Failed to crawl site', {details: {url: archive.url, err: err.toString()}})
    uwgEvents.emit('crawl-error', {sourceUrl: archive.url, err: err.toString()})
  } finally {
    uwgEvents.emit('crawl-finish', {sourceUrl: archive.url})
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
    try {
      var meta = await archivesDb.getMeta(toHostname(url))
      return {url, title: meta.title, datasetVersions, updatedAt}
    } catch (e) {
      console.error('Error loading archive meta', url, e)
      return {url, title: '', datasetVersions: {}, updatedAt: null}
    }
  }))
}

const resetSite =
exports.resetSite = async function (url) {
  url = await dat.archives.getPrimaryUrl(url)
  var release = await lock('crawl:' + url)
  try {
    logger.debug('Resetting site', {details: {url}})
    await db.run(`DELETE FROM crawl_sources WHERE url = ?`, [url])
  } finally {
    release()
  }
}

exports.WEBAPI = {
  listSuggestions: require('./search').listSuggestions,
  createEventsStream,
  getCrawlStates,
  crawlSite,
  resetSite
}