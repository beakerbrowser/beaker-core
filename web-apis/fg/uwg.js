const errors = require('beaker-error-constants')
const {EventTargetFromStream} = require('./event-target')

const RPC_OPTS = { timeout: false, errors }
const APIs = {
  bookmarks: {
    manifest: require('../manifests/external/unwalled-garden-bookmarks'),
    create: makeCreateFn('unwalled-garden-bookmarks')
  },
  comments: {
    manifest: require('../manifests/external/unwalled-garden-comments'),
    create: makeCreateFn('unwalled-garden-comments')
  },
  follows: {
    manifest: require('../manifests/external/unwalled-garden-follows'),
    create: makeCreateFn('unwalled-garden-follows')
  },
  library: {
    manifest: require('../manifests/external/unwalled-garden-library'),
    create: makeCreateFn('unwalled-garden-library')
  },
  statuses: {
    manifest: require('../manifests/external/unwalled-garden-statuses'),
    create: makeCreateFn('unwalled-garden-statuses')
  },
  profiles: {
    manifest: require('../manifests/external/unwalled-garden-profiles'),
    create: makeCreateFn('unwalled-garden-profiles')
  },
  reactions: {
    manifest: require('../manifests/external/unwalled-garden-reactions'),
    create: makeCreateFn('unwalled-garden-reactions')
  },
  votes: {
    manifest: require('../manifests/external/unwalled-garden-votes'),
    create: makeCreateFn('unwalled-garden-votes')
  }
}

exports.setup = function (rpc) {
  const uwg = {}
  for (let name in APIs) {
    uwg[name] = APIs[name].create(name, rpc)
  }
  return uwg
}

function makeCreateFn (channel) {
  return (name, rpc) => {
    var rpcInst = rpc.importAPI(channel, APIs[name].manifest, RPC_OPTS)
    var api = {}
    for (let method in APIs[name].manifest) {
      api[method] = rpcInst[method].bind(api)
    }
    return api
  }
}