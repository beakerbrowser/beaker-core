const errors = require('beaker-error-constants')
const {EventTargetFromStream} = require('./event-target')

const RPC_OPTS = { timeout: false, errors }
const APIs = {
  bookmarks: {
    manifest: require('../manifests/external/bookmarks'),
    create: makeCreateFn('bookmarks')
  },
  library: {
    manifest: require('../manifests/external/library'),
    create (rpc) {
      var libraryMethods = ['list', 'get', 'add', 'requestAdd', 'edit', 'remove', 'requestRemove', 'uncache']
      var libraryEvents = ['added', 'removed', 'updated', 'folder-synced', 'network-changed']
      var libraryRPC = rpc.importAPI('library', APIs.library.manifest, RPC_OPTS)
      var api = new EventTargetFromStream(libraryRPC.createEventStream.bind(libraryRPC), libraryEvents)
      for (let method of libraryMethods) {
        api[method] = libraryRPC[method].bind(api)
      }
      return api
    }
  },
  profiles: {
    manifest: require('../manifests/external/profiles'),
    create: makeCreateFn('profiles')
  },
  search: {
    manifest: require('../manifests/external/search'),
    create: makeCreateFn('search')
  },
  'unwalled-garden-posts': {
    manifest: require('../manifests/external/unwalled-garden-posts'),
    create: makeCreateFn('unwalled-garden-posts')
  },
  'unwalled-garden-graph': {
    manifest: require('../manifests/external/unwalled-garden-graph'),
    create: makeCreateFn('unwalled-garden-graph')
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
    throw new Error(`Unknown API: ${name}`)
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