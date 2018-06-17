
// helper to make node-style CBs into promises
// usage: cbPromise(cb => myNodeStyleMethod(cb)).then(...)
exports.cbPromise = function (method, b) {
  return new Promise((resolve, reject) => {
    method((err, value) => {
      if (err) reject(err)
      else resolve(value)
    })
  })
}
