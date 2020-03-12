const { contextBridge } = require('electron')
const DatArchive = require('./fg/dat-archive')
const beaker = require('./fg/beaker')
const experimental = require('./fg/experimental')

exports.setup = function ({rpcAPI}) {
  // setup APIs
  if (['beaker:', 'dat:', 'https:'].includes(window.location.protocol) ||
      (window.location.protocol === 'http:' && window.location.hostname === 'localhost')) {
    DatArchive.setupAndExpose(rpcAPI)
  }
  if (['beaker:', 'dat:'].includes(window.location.protocol)) {
    contextBridge.exposeInMainWorld('beaker', beaker.setup(rpcAPI))
    contextBridge.exposeInMainWorld('experimental', experimental.setup(rpcAPI))
  }
}
