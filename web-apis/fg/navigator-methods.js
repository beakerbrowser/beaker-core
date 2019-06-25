const errors = require('beaker-error-constants')
const manifest = require('../manifests/external/navigator')

const RPC_OPTS = { timeout: false, errors }

exports.setup = function (rpc) {
  var api = rpc.importAPI('navigator', manifest, RPC_OPTS)
  for (let k in manifest) {
    navigator[k] = api[k].bind(api)
  }
}
