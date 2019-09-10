const errors = require('beaker-error-constants')
const {EventTargetFromStream} = require('./event-target')

const RPC_OPTS = { timeout: false, errors }
const APIs = {
  'unwalled-garden-bookmarks': {
    manifest: require('../manifests/external/unwalled-garden-bookmarks'),
    create: makeCreateFn('unwalled-garden-bookmarks')
  },
  search: {
    manifest: require('../manifests/external/search'),
    create: makeCreateFn('search')
  },
  'unwalled-garden-comments': {
    manifest: require('../manifests/external/unwalled-garden-comments'),
    create: makeCreateFn('unwalled-garden-comments')
  },
  'unwalled-garden-follows': {
    manifest: require('../manifests/external/unwalled-garden-follows'),
    create: makeCreateFn('unwalled-garden-follows')
  },
  'unwalled-garden-statuses': {
    manifest: require('../manifests/external/unwalled-garden-statuses'),
    create: makeCreateFn('unwalled-garden-statuses')
  },
  'unwalled-garden-profiles': {
    manifest: require('../manifests/external/unwalled-garden-profiles'),
    create: makeCreateFn('unwalled-garden-profiles')
  },
  'unwalled-garden-reactions': {
    manifest: require('../manifests/external/unwalled-garden-reactions'),
    create: makeCreateFn('unwalled-garden-reactions')
  },
  'unwalled-garden-tags': {
    manifest: require('../manifests/external/unwalled-garden-tags'),
    create: makeCreateFn('unwalled-garden-tags')
  },
  'unwalled-garden-votes': {
    manifest: require('../manifests/external/unwalled-garden-votes'),
    create: makeCreateFn('unwalled-garden-votes')
  }
}

var cache = {}

exports.setup = function (rpc) {
  return function (name) {
    if (name in cache) return cache[name]
    if (name in APIs) {
      const API = APIs[name]
      cache[name] = API.create(rpc)
      return cache[name]
    }
    console.error(`Unknown API: ${name}`)
    return null
  }
}

function makeCreateFn (name) {
  return rpc => {
    var rpcInst = rpc.importAPI(name, APIs[name].manifest, RPC_OPTS)
    var api = {}
    for (let method in APIs[name].manifest) {
      api[method] = rpcInst[method].bind(api)
    }
    return api
  }
}