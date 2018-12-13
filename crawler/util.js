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
    SELECT crawlSourceVersion, crawlDatasetVersion FROM crawl_sources_meta
      WHERE crawlSourceId = ? AND crawlDataset = ?
  `, [crawlSource.id, crawlDataset])
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
  console.log('fetching changes', archive.url, start, end, state)
  var changes = await new Promise((resolve, reject) => {
    pump(
      archive.history({start, end, timeout: READ_TIMEOUT}),
      concat({encoding: 'object'}, resolve),
      reject
    )
  })

  // handle changes
  await handlerFn({changes, resetRequired})

  // final checkpoint
  await doCheckpoint(crawlDataset, crawlDatasetVersion, crawlSource, version)
}

const doCheckpoint = exports.doCheckpoint = async function (crawlDataset, crawlDatasetVersion, crawlSource, crawlSourceVersion) {
  await db.run(`DELETE FROM crawl_sources_meta WHERE crawlDataset = ? AND crawlSourceId = ?`, [crawlDataset, crawlSource.id])
  await db.run(`
    INSERT
      INTO crawl_sources_meta (crawlDataset, crawlDatasetVersion, crawlSourceId, crawlSourceVersion, updatedAt)
      VALUES (?, ?, ?, ?, ?)
  `, [crawlDataset, crawlDatasetVersion, crawlSource.id, crawlSourceVersion, Date.now()])
}

exports.getMatchingChangesInOrder = function (changes, regex) {
  var list = [] // order matters, must be oldest to newest
  changes.forEach(c => {
    if (regex.test(c.name)) {
      let i = list.findIndex(c2 => c2.name === c.name)
      if (i !== -1) list.splice(i, 1) // remove from old position
      list.push(c)
    }
  })
  return list
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