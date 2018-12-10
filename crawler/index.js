const _throttle = require('lodash.throttle')
const lock = require('../lib/lock')
const db = require('../dbs/profile-data-db')
const users = require('../users')
const dat = require('../dat')

const posts = require('./posts')
const followgraph = require('./followgraph')

const CRAWL_POLL_INTERVAL = 30e3

// globals
// =

const watches = {}

// exported api
// =

exports.posts = posts
exports.followgraph = followgraph

exports.setup = async function () {
}

exports.watchSite = async function (archive) {
  if (typeof archive === 'string') {
    archive = await dat.library.getOrLoadArchive(archive)
  }
  console.log('watchSite', archive.url)

  if (!(archive.url in watches)) {
    const queueCrawl = _throttle(() => crawlSite(archive), 5e3)

    // watch for file changes
    watches[archive.url] = archive.pda.watch()
    watches[archive.url].on('data', ([event, args]) => {
      console.log('MIRACLE ALERT! The crawler watch stream emitted a change event', archive.url, event, args)
      if (event === 'invalidated') {
        queueCrawl()
      }
    })

    // HACK
    // for reasons that currently surpass me
    // the `archive.pda.watch()` call is not currently working all the time
    // so we need to poll sites for now
    setInterval(queueCrawl, CRAWL_POLL_INTERVAL)

    // run the first crawl
    crawlSite(archive)
  }
}

exports.unwatchSite = async function (url) {
  // stop watching for file changes
  if (url in watches) {
    watches[url].close()
    watches[url] = null
  }
}

const crawlSite =
exports.crawlSite = async function (archive) {
  console.log('crawling', archive.url)
  var release = await lock('crawl:' + archive.url)
  try {
    // get/create crawl source
    var crawlSource = await db.get(`SELECT id FROM crawl_sources WHERE url = ?`, [archive.url])
    if (!crawlSource) {
      await db.run(`INSERT INTO crawl_sources (url) VALUES (?)`, [archive.url])
      crawlSource = {id: db.getSqliteInstance().lastID, url: archive.url}
    }

    // crawl individual sources
    await Promise.all([
      posts.crawlSite(archive, crawlSource),
      followgraph.crawlSite(archive, crawlSource)
    ])
  } finally {
    release()
  }
}
exports.crawlSite = crawlSite