const errors = require('beaker-error-constants')
const manifest = require('../manifests/external/navigator')
const sessionManifest = require('../manifests/external/navigator-session')

const RPC_OPTS = { timeout: false, errors }

exports.setup = function (rpc) {
  var api = rpc.importAPI('navigator', manifest, RPC_OPTS)
  for (let k in manifest) {
    if (typeof api[k] === 'function') {
      navigator[k] = api[k].bind(api)
    }
  }

  navigator.session = {}
  var sessionApi = rpc.importAPI('navigator-session', sessionManifest, RPC_OPTS)
  for (let k in sessionManifest) {
    if (typeof sessionApi[k] === 'function') {
      navigator.session[k] = sessionApi[k].bind(sessionApi)
    }
  }
}
