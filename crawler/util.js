const db = require('../dbs/profile-data-db')

exports.doCrawl = async function (archive, crawlDataset, crawlDatasetVersion, handlerFn) {
  const url = archive.url

  // fetch current crawl state
  var resetRequired = false
  var state = await db.get(`
    SELECT crawl_sources_meta.* FROM crawl_sources_meta
      INNER JOIN crawl_sources ON crawl_sources.url = ?
      WHERE crawl_sources_meta.crawlDataset = ?
  `, [url, crawlDataset])
  if (state.crawlDatasetVersion !== crawlDatasetVersion) {
    resetRequired = true
    state = null
  }
  if (!state) {
    // new state
    state = {
      crawlSourceId: null,
      url,
      crawlDataset,
      crawlDatasetVersion,
      updatedAt: 0
    }
  }

  // fetch current archive version
  // TODO

  // fetch change log
  var changes = [] // TODO

  // handle changes
  await handlerFn({changes, resetRequired})

  if (!state.crawlSourceId) {
    // upsert crawl source
    // TODO
  }

  // upsert crawl state
  state.updatedAt = Date.now()
  // TODO
}

exports.doCheckpoint = async function (crawlDataset, crawlDatasetVersion, crawlSourceId, crawlSourceVersion) {
  // TODO
}

var _lastGeneratedTimeFilename
exports.generateTimeFilename = function () {
  var d = Date.now()
  if (d === _lastGeneratedTimeFilename) {
    d++
  }
  _lastGeneratedTimeFilename = d
  return (new Date(d)).toISOString()
}