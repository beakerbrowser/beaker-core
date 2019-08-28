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
  'unwalled-garden-posts': {
    manifest: require('../manifests/external/unwalled-garden-posts'),
    create: makeCreateFn('unwalled-garden-posts')
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