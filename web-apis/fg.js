const DatArchive = require('./fg/dat-archive')
const beaker = require('./fg/beaker')
const experimental = require('./fg/experimental')
const uwg = require('./fg/uwg')
const navigatorMethods = require('./fg/navigator-methods')

exports.setup = function ({rpcAPI}) {
  // setup APIs
  if (['beaker:', 'dat:', 'https:'].includes(window.location.protocol) ||
      (window.location.protocol === 'http:' && window.location.hostname === 'localhost')) {
    window.DatArchive = DatArchive.setup(rpcAPI)
    navigatorMethods.setup(rpcAPI)
  }
  if (['beaker:', 'dat:'].includes(window.location.protocol)) {
    window.beaker = beaker.setup(rpcAPI)
    window.experimental = experimental.setup(rpcAPI)
    window.UwG = uwg.setup(rpcAPI)
  }
}