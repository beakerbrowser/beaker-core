const spellCheckerManifest = require('../manifests/external/spell-checker')

module.exports = function (rpc) {
    // create the rpc apis
    return rpc.importAPI('spell-checker', spellCheckerManifest)
}