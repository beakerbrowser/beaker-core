const winston = require('winston')
const fs = require('fs')
const jetpack = require('fs-jetpack')
const fsReverse = require('fs-reverse')
const concat = require('concat-stream')
const pump = require('pump')
const split2 = require('split2')
const through2 = require('through2')
const {Readable} = require('stream')
const {combine, timestamp, json, simple, colorize, padLevels} = winston.format
const tailFile = require('./lib/tail-file')

// typedefs
// =

/**
 * @typedef {Object} LogQueryOpts
 * @prop {number} [logFile = 0] - Which logfile to read
 * @prop {string} [sort = 'asc'] - Sort direction
 * @prop {number} [since] - Start time
 * @prop {number} [until] - End time
 * @prop {number} [offset] - Event-slice offset
 * @prop {number} [limit] - Max number of objects to output
 * @prop {any} [filter] - Attribute filters
 */

// globals
// =

var logPath
const logger = winston.createLogger({
  level: 'silly'
})

// exported api
// =

exports.setup = async function (p) {
  logPath = p

  // rotate logfiles from previous runs
  await retireLogFile(5)
  for (let i = 4; i >= 0; i--) {
    await rotateLogFile(i)
  }

  logger.add(new winston.transports.File({
    filename: logPath,
    format: combine(timestamp(), json())
  }))

  // TODO if debug (pick an env var for this)
  logger.add(new winston.transports.Console({
    level: 'verbose',
    format: combine(colorize(), padLevels(), simple())
  }))

  logger.info('Program start')
}

exports.get = () => logger
exports.category = (category) => logger.child({category})
exports.child = (arg) => logger.child(arg)

/**
 * Query a slice of the log.
 * @param {LogQueryOpts} [opts]
 * @returns {Promise<Object[]>}
 */
const query = exports.query = async (opts = {}) => {
  return new Promise((resolve, reject) => {
    opts.limit = opts.limit || 100
    var readFn = opts.sort === 'desc' ? fsReverse : fs.createReadStream
    var readStream = readFn(getLogPath(opts.logFile || 0), {encoding: 'utf8'})
    const nosplit = (readFn === fsReverse) // fs-reverse splits for us
    pump(
      readPipeline(readStream, opts, nosplit),
      concat({encoding: 'object'}, res => resolve(/** @type any */(res))),
      reject
    )
  })
}

/**
 * Create a read stream of the log.
 * @param {LogQueryOpts} [opts]
 * @returns {NodeJS.ReadStream}
 */
const stream = exports.stream = (opts = {}) => {
  var readStream = tailFile(getLogPath(opts.logFile || 0))
  return readPipeline(readStream, opts)
}

exports.WEBAPI = {
  query,
  stream: opts => {
    opts = opts || {}
    var s2 = new Readable({
      read () {},
      objectMode: true
    })
    var s1 = stream(opts)
    // convert to the emit-stream form
    s1.on('data', v => {
      s2.push(['data', v])
    })
    s1.on('error', v => s2.push(['error', v]))
    s1.on('close', v => {
      s2.push(['close', v])
      s2.destroy()
    })
    s2.on('close', () => s1.destroy())
    return s2
  }
}

// internal methods
// =

function massageFilters (filter) {
  if (filter && typeof filter === 'object') {
    // make each filter an array
    for (let k in filter) {
      filter[k] = Array.isArray(filter[k]) ? filter[k] : [filter[k]]
    }
  } else {
    filter = false
  }
  return filter
}

function getLogPath (num) {
  if (num) return logPath + '.' + num
  return logPath
}

async function rotateLogFile (num) {
  try {
    var p = getLogPath(num)
    var info = await jetpack.inspectAsync(p)
    if (info && info.type === 'file') {
      await jetpack.moveAsync(p, getLogPath(num + 1))
    }
  } catch (err) {
    console.error('rotateLogFile failed', num, err)
  }
}

async function retireLogFile (num) {
  try {
    var p = getLogPath(num)
    var info = await jetpack.inspectAsync(p)
    if (info && info.type === 'file') {
      await jetpack.removeAsync(p)
    }
  } catch (err) {
    console.error('retireLogFile failed', num, err)
  }
}

/**
 * @param {any} readStream
 * @param {LogQueryOpts} opts
 * @returns {any}
 */
function readPipeline (readStream, opts, nosplit = false) {
  var beforeOffset = 0
  var beforeLimit = 0
  var offset = opts.offset || 0
  var limit = opts.limit
  var filter = massageFilters(opts.filter)
  return pump([
    readStream,
    nosplit ? undefined : split2(),
    through2.obj(function (row, enc, cb) {
      if (!row || !row.trim()) {
        // skip empty
        return cb()
      }

      // offset filter
      if (beforeOffset < offset) {
        beforeOffset++
        return cb()
      }

      // parse
      row = JSON.parse(row)

      // timestamp range filter
      var ts = (opts.since || opts.until) ? (new Date(row.timestamp)).getTime() : null
      if ('since' in opts && ts < opts.since) return cb()
      if ('until' in opts && ts > opts.until) return cb()

      // general string filters
      if (filter) {
        for (let k in filter) {
          if (!filter[k].includes(row[k])) return cb()
        }
      }

      // emit
      if (!limit || beforeLimit < limit) this.push(row)
      if (limit && ++beforeLimit === limit) readStream.destroy()
      cb()
    })
  ].filter(Boolean))
}