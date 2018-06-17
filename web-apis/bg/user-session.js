const {getAppPermissions} = require('../../dbs/sitedata')

// exported api
// =

module.exports = {
  // fetch the sender's session data
  async fetch () {
    return {
      permissions: await getAppPermissions(this.sender.getURL())
    }
  }
}
