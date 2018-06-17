exports.getEnvVar = function (name) {
  var ucv = process.env[name.toUpperCase()]
  if (typeof ucv !== 'undefined') {
    return ucv
  }
  var lcv = process.env[name.toLowerCase()]
  if (typeof lcv !== 'undefined') {
    return lcv
  }
  return undefined
}
