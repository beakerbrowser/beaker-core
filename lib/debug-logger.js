const fs = require('fs')
const {format} = require('util')
const concat = require('concat-stream')

var logFilePath
var logFileWriteStream

/**
 * @param {string} p - Path to the log file.
 */
exports.setup = function (p) {
  logFilePath = p
  console.log('Logfile:', logFilePath)

  logFileWriteStream = fs.createWriteStream(logFilePath, {encoding: 'utf8'})
  logFileWriteStream.write(format('Log started at %s\n', new Date()))
  logFileWriteStream.on('error', e => {
    console.log('Failed to open debug.log', e)
  })
}

/**
 * Produces a logger function for the given namespace.
 * @param {string} namespace
 * @returns {function(...any): void}
 */
exports.debugLogger = function (namespace) {
  return function (fmt, ...args) {
    if (logFileWriteStream) {
      logFileWriteStream.write(namespace + ' ' + format(fmt, ...args) + '\n')
    } else {
      console.error(namespace + ' ' + format(fmt, ...args) + '\n')
    }
  }
}

/**
 * @returns {string}
 */
exports.getLogFilePath = function () {
  return logFilePath
}

/**
 * @param {number} start
 * @param {number} end
 * @returns {Promise<string>}
 */
exports.getLogFileContent = function (start, end) {
  start = start || 0
  end = end || 10e5
  return new Promise(resolve => (
    fs.createReadStream(logFilePath, {start, end})
      .pipe(concat(res => resolve(res.toString('utf8'))))
  ))
}
