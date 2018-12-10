const pump = require('pump')
const concat = require('concat-stream')
const db = require('../dbs/profile-data-db')
const dat = require('../dat')

const READ_TIMEOUT = 30e3

exports.doCrawl = async function (archive, crawlSource, crawlDataset, crawlDatasetVersion, handlerFn) {
  const url = archive.url

  // fetch current crawl state
  var resetRequired = false
  var state = await db.get(`
    SELECT meta.crawlSourceVersion, meta.crawlDatasetVersion FROM crawl_sources_meta meta
      INNER JOIN crawl_sources ON crawl_sources.url = ?
      WHERE meta.crawlDataset = ?
  `, [url, crawlDataset])
  if (state && state.crawlDatasetVersion !== crawlDatasetVersion) {
    resetRequired = true
    state = null
  }
  if (!state) {
    state = {crawlSourceVersion: 0, crawlDatasetVersion}
  }

  // fetch current archive version
  var archiveInfo = await dat.library.getDaemon().getArchiveInfo(archive.key)
  var version = archiveInfo ? archiveInfo.version : 0

  // fetch change log
  var start = state.crawlSourceVersion + 1
  var end = version + 1
  console.log('fetching changes', start, end, state)
  var changes = await new Promise((resolve, reject) => {
    pump(
      archive.history({start, end, timeout: READ_TIMEOUT}),
      concat({encoding: 'object'}, resolve),
      reject
    )
  })

  // handle changes
  await handlerFn({changes, resetRequired})
}

exports.doCheckpoint = async function (crawlDataset, crawlDatasetVersion, crawlSource, crawlSourceVersion) {
  await db.run(`DELETE FROM crawl_sources_meta WHERE crawlDataset = ? AND crawlSourceId = ?`, [crawlDataset, crawlSource.id])
  await db.run(`
    INSERT
      INTO crawl_sources_meta (crawlDataset, crawlDatasetVersion, crawlSourceId, crawlSourceVersion, updatedAt)
      VALUES (?, ?, ?, ?, ?)
  `, [crawlDataset, crawlDatasetVersion, crawlSource.id, crawlSourceVersion, Date.now()])
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