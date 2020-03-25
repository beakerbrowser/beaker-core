const webApis = require('./web-apis/fg')

exports.setup = function ({rpcAPI}) {
  webApis.setup({rpcAPI})
}
