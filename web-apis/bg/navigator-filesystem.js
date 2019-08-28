const { PermissionsError } = require('beaker-error-constants')
const filesystem = require('../../filesystem')

// typedefs
// =

/**
 * @typedef {Object} NavigatorFilesystemPublicAPIRootArchiveRecord
 * @prop {string} url
 */

// exported api
// =

module.exports = {
  /**
   * @returns {Promise<NavigatorFilesystemPublicAPIRootArchiveRecord>}
   */
  async getRootArchive () {
    if (!this.sender.getURL().startsWith('beaker:')) {
      throw new PermissionsError()
    }
    return {
      url: filesystem.get().url
    }
  }
}
