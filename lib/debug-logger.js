const fs = require('fs')
const {format} = require('util')
const concat = require('concat-stream')

var logFilePath
var logFileWriteStream

exports.setup = function (p) {
  logFilePath = p
  console.log('Logfile:', logFilePath)

  logFileWriteStream = fs.createWriteStream(logFilePath, {encoding: 'utf8'})
  logFileWriteStream.write(format('Log started at %s\n', new Date()))
  logFileWriteStream.on('error', e => {
    console.log('Failed to open debug.log', e)
  })
}

exports.debugLogger = function (namespace) {
  return function (...args) {
    if (logFileWriteStream) {
      logFileWriteStream.write(namespace + ' ' + format(...args) + '\n')
    } else {
      console.error(namespace + ' ' + format(...args) + '\n')
    }
  }
}

exports.getLogFilePath = function () {
  return logFilePath
}

exports.getLogFileContent = function (start, end) {
  start = start || 0
  end = end || 10e5
  return new Promise(resolve => fs.createReadStream(logFilePath, {start, end}).pipe(concat({encoding: 'string'}, resolve)))
}
