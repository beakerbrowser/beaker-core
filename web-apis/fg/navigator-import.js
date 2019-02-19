const errors = require('beaker-error-constants')
const {EventTargetFromStream} = require('./event-target')

const RPC_OPTS = { timeout: false, errors }
const APIs = {
  bookmarks: {
    manifest: require('../manifests/external/bookmarks'),
    create (rpc) {
      var bookmarksRPC = rpc.importAPI('bookmarks', APIs.bookmarks.manifest, RPC_OPTS)
      var api = {}
      for (let method in APIs.bookmarks.manifest) {
        api[method] = bookmarksRPC[method].bind(api)
      }
      return api
    }
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
    create (rpc) {
      var profilesRPC = rpc.importAPI('profiles', APIs.profiles.manifest, RPC_OPTS)
      var api = {}
      for (let method in APIs.profiles.manifest) {
        api[method] = profilesRPC[method].bind(api)
      }
      return api
    }
  },
  'unwalled-garden-feed': {
    manifest: require('../manifests/external/unwalled-garden-feed'),
    create (rpc) {
      var feedRPC = rpc.importAPI('unwalled-garden-feed', APIs['unwalled-garden-feed'].manifest, RPC_OPTS)
      var api = {}
      for (let method in APIs['unwalled-garden-feed'].manifest) {
        api[method] = feedRPC[method].bind(api)
      }
      return api
    }
  }
  // TODO 'unwalled-garden-followgraph': require('../manifests/external/unwalled-garden-followgraph')
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