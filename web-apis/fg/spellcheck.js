const spellCheckManifest = require('../manifests/external/spellcheck')

module.exports = function (rpc) {
    // create the rpc apis
    return rpc.importAPI('spellchecker', spellCheckManifest, { timeout: false })
}