const winston = require('winston')
const concat = require('concat-stream')
const pump = require('pump')
const through2 = require('through2')
const {combine, timestamp, json, simple, colorize, padLevels} = winston.format

// typedefs
// =

/**
 * @typedef {Object} LogStreamOpts
 * @prop {number} [from] - Start time
 * @prop {number} [to] - End time
 * @prop {number} [offset] - Event-slice offset
 * @prop {number} [limit] - Max number of objects to output
 * @prop {any} [filters] - Attribute filters
 */

// globals
// =

const logger = winston.createLogger({
  level: 'silly'
})

// exported api
// =

exports.setup = function (logPath) {
  logger.add(new winston.transports.File({
    filename: logPath,
    format: combine(timestamp(), json())
  }))
  
  // TODO if debug (pick an env var for this)
  logger.add(new winston.transports.Console({
    level: 'debug',
    format: combine(colorize(), padLevels(), simple())
  }))

  logger.verbose('Program start')
}

exports.get = () => logger
exports.category = (category) => logger.child({category})
exports.child = (arg) => logger.child(arg)

/**
 * Query a slice of the log.
 * @param {LogStreamOpts} [opts]
 * @returns {Promise<Object[]>}
 */
exports.query = async (opts) => {
  return new Promise((resolve, reject) => {
    pump(
      stream(opts),
      concat({encoding: 'object'}, objs => resolve(/** @type any */(objs))),
      reject
    )
  })
}

/**
 * Create a read stream of the log.
 * @param {LogStreamOpts} [opts]
 * @returns {NodeJS.ReadStream}
 */
const stream = exports.stream = (opts = {}) => {
  var n = 0

  var filters = opts.filters
  if (filters && typeof filters === 'object') {
    // make each filter an array
    for (let k in filters) {
      filters[k] = Array.isArray(filters[k]) ? filters[k] : [filters[k]]
    }
  } else {
    filters = false
  }

  var logStream = logger.stream({start: opts.offset || undefined})
  return logStream.pipe(through2.obj((row, enc, cb) => {
      var ts = (opts.from || opts.to) ? (new Date(row.timestamp)).getTime() : null
      if ('from' in opts && ts < opts.from) return cb()
      if ('to' in opts && ts > opts.to) return cb()
      if (filters) {
        for (let k in filters) {
          if (!filters[k].includes(row[k])) return cb()
        }
      }
      this.push(row)
      if (opts.limit && ++n >= opts.limit) logStream.destroy()
    }))
}
