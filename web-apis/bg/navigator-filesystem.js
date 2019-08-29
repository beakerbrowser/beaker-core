const { PermissionsError } = require('beaker-error-constants')
const filesystem = require('../../filesystem')

// typedefs
// =

/**
 * @typedef {Object} NavigatorFilesystemPublicAPIRootRecord
 * @prop {string} url
 */

// exported api
// =

module.exports = {
  /**
   * @returns {Promise<NavigatorFilesystemPublicAPIRootRecord>}
   */
  async getRoot () {
    if (!this.sender.getURL().startsWith('beaker:')) {
      throw new PermissionsError()
    }
    return {
      url: filesystem.get().url
    }
  }
}
