const _throttle = require('lodash.throttle')
const lock = require('../lib/lock')
const users = require('../users')
const dat = require('../dat')

const posts = require('./posts')
const followgraph = require('./followgraph')

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
    archive = await dat.library.getOrLoadArchive()
  }

  if (!(archive.url in watches)) {
    const queueCrawl = _throttle(() => crawlSite(archive), 5e3)

    // watch for file changes
    watches[archive.url] = archive.pda.watch()
    watches[archive.url].on('data', ([event, args]) => {
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
    watches[url].close()
    watches[url] = null
  }
}

async function crawlSite (archive) {
  var release = await lock('crawl:' + archive.url)
  try {
    await Promise.all([
      posts.crawlSite(archive),
      followgraph.crawlSite(archive)
    ])
  } finally {
    release()
  }
}
exports.crawlSite = crawlSite