const db = require('../dbs/profile-data-db')
const dat = require('../dat')

const READ_TIMEOUT = 30e3

exports.doCrawl = async function (archive, crawlSourceId, crawlDataset, crawlDatasetVersion, handlerFn) {
  const url = archive.url

  // fetch current crawl state
  var resetRequired = false
  var state = await db.get(`
    SELECT crawl_sources_meta.crawlSourceVersion FROM crawl_sources_meta
      INNER JOIN crawl_sources ON crawl_sources.url = ?
      WHERE crawl_sources_meta.crawlDataset = ?
  `, [url, crawlDataset])
  if (state && state.crawlDatasetVersion !== crawlDatasetVersion) {
    resetRequired = true
    state = null
  }
  if (!state) {
    state = {crawlSourceVersion: 0}
  }

  // fetch current archive version
  var archiveInfo = await dat.library.getDaemon().getArchiveInfo(archive.key)
  var version = archiveInfo ? archiveInfo.version : 0

  // fetch change log
  var start = state.crawlSourceVersion
  var end = version
  var changes = await new Promise((resolve, reject) => {
    archive.history({start, end, timeout: READ_TIMEOUT}, (err, c) => {
      if (err) reject(err)
      else resolve(c)
    })
  })

  // handle changes
  await handlerFn({changes, resetRequired})
}

exports.doCheckpoint = async function (crawlDataset, crawlDatasetVersion, crawlSourceId, crawlSourceVersion) {
  await db.run(`
    INSERT OR REPLACE
      INTO crawl_sources_meta (crawlDataset, crawlDatasetVersion, crawlSourceId, crawlSourceVersion, updatedAt)
      VALUES (?, ?, ?, ?, ?)
  `, [crawlDataset, crawlDatasetVersion, crawlSourceId, crawlSourceVersion, Date.now()])
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