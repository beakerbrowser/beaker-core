const errors = require('beaker-error-constants')
const {EventTargetFromStream} = require('./event-target')

const RPC_OPTS = { timeout: false, errors }
const APIs = {
  bookmarks: require('../manifests/external/bookmarks'),
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
  }
  // TODO profiles: require('../manifests/external/profiles'),
  // TODO 'unwalled-garden-feed': require('../manifests/external/unwalled-garden-feed'),
  // TODO 'unwalled-garden-followgraph': require('../manifests/external/unwalled-garden-followgraph')
}

var cache = {}

exports.setup = function (rpc) {
  return function (name) {
    if (name in cache) return cache[name]
    if (name in APIs) {
      const API = APIs[name]
      cache[name] = API.create ? API.create(rpc) : rpc.importAPI(name, APIs[name], RPC_OPTS)
      return cache[name]
    }
    throw new Error(`Unknown API: ${name}`)
  }
}