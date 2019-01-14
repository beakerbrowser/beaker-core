const moment = require('moment')
const {TimeoutError} = require('beaker-error-constants')

/**
 * @typedef {import('moment').Moment} Moment
 * @typedef {import('moment').LocaleSpecification} LocaleSpecification
 * */

moment.updateLocale('en', /** @type LocaleSpecification */({
  relativeTime: {s: 'seconds'}
}))

/**
 * Create a relative date string.
 * @param {number | Date | Moment} ts
 * @param {Object} [opts]
 * @param {boolean} [opts.noTime] - Don't include the time of the day if today (just say 'today').
 * @returns {string}
 */
exports.niceDate = function (ts, opts) {
  const endOfToday = moment().endOf('day')
  if (typeof ts === 'number' || ts instanceof Date) { ts = moment(ts) }
  if (ts.isSame(endOfToday, 'day')) {
    if (opts && opts.noTime) { return 'today' }
    return ts.fromNow()
  } else if (ts.isSame(endOfToday.subtract(1, 'day'), 'day')) { return 'yesterday' } else if (ts.isSame(endOfToday, 'month')) { return ts.fromNow() }
  return ts.format('ll')
}

/**
 * A wrapper for any behavior that needs to maintain a timeout.
 * Rules of usage:
 * - Call `checkin` after a period of async work to give the timer a chance to
 *   abort further work. If the timer has expired, checkin() will stop running.
 * - Give `checkin` a description of the task if you want the timeouterror to be
 *   descriptive.
 * @example
 * timer(30e3, async (checkin, pause, resume) => {
 *   checkin('doing work')
 *   await work()
 *
 *   checkin('doing other work')
 *   await otherWork()
 *
 *   pause() // dont count this period against the timeout
 *   await askUserSomething()
 *   resume() // resume the timeout
 *
 *   checkin('finishing')
 *   return finishing()
 * })
 * @param {number} ms
 * @param {function(Function, Function, Function): Promise<any>} fn
 * @returns {Promise<any>}
 */
exports.timer = function (ms, fn) {
  var currentAction
  var isTimedOut = false

  // no timeout?
  if (!ms) return fn(noop, noop, noop)

  return new Promise((resolve, reject) => {
    var timer
    var remaining = ms
    var start

    const checkin = action => {
      if (isTimedOut) throw new TimeoutError() // this will abort action, but the wrapping promise is already rejected
      if (action) currentAction = action
    }
    const pause = () => {
      clearTimeout(timer)
      remaining -= (Date.now() - start)
    }
    const resume = () => {
      if (isTimedOut) return
      clearTimeout(timer)
      start = Date.now()
      timer = setTimeout(onTimeout, remaining)
    }
    const onTimeout = () => {
      isTimedOut = true
      reject(new TimeoutError(currentAction ? `Timed out while ${currentAction}` : undefined))
    }

    // call the fn to get the promise
    var promise = fn(checkin, pause, resume)

    // start the timer
    resume()

    // wrap the promise
    promise.then(
      val => {
        clearTimeout(timer)
        resolve(val)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function noop () {}
