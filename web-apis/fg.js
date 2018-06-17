const DatArchive = require('./fg/dat-archive')
const beaker = require('./fg/beaker')
const experimental = require('./fg/experimental')

exports.setup = function ({rpcAPI}) {
  // setup APIs
  if (['beaker:', 'dat:', 'https:'].includes(window.location.protocol) ||
      (window.location.protocol === 'http:' && window.location.hostname === 'localhost')) {
    window.DatArchive = DatArchive.setup(rpcAPI)
  }
  if (['beaker:', 'dat:'].includes(window.location.protocol)) {
    window.beaker = beaker.setup(rpcAPI)
    window.experimental = experimental.setup(rpcAPI)
  }
}
