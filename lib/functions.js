/**
 * Helper to make node-style CBs into promises
 * @example
 * cbPromise(cb => myNodeStyleMethod(cb)).then(...)
 * @param {function(Function): any} method
 * @returns {Promise<any>}
 */
exports.cbPromise = function (method) {
  return new Promise((resolve, reject) => {
    method((err, value) => {
      if (err) reject(err)
      else resolve(value)
    })
  })
}
