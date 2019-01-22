/**
 * This logger is just an event-emitter wrapper which streams to the main process.
 * The main process then folds the events into the main logger.
 */

const Emitter = require('events')

// globals
// =

const events = new Emitter()

// exported api
// =

exports.events = events

exports.child = (meta = {}) => {
  const log = (level, message, etc = {}) => {
    Object.assign(etc, meta)
    events.emit('log', {level, message, etc})
  }
  return {
    log,
    error: (...args) => log('error', ...args),
    warn: (...args) => log('warn', ...args),
    info: (...args) => log('info', ...args),
    verbose: (...args) => log('verbose', ...args),
    debug: (...args) => log('debug', ...args),
    silly: (...args) => log('silly', ...args)
  }
}