const parseDatURL = require('parse-dat-url')
const {PermissionsError} = require('beaker-error-constants')
const globals = require('../../../globals')
const datLibrary = require('../../../dat/library')
const datDns = require('../../../dat/dns')
const datExtensions = require('../../../dat/extensions')
const {DAT_HASH_REGEX} = require('../../../lib/const')

// constants
// =

const API_DOCS_URL = 'https://beakerbrowser.com/docs/apis/experimental-datpeers.html'
const API_PERM_ID = 'experimentalDatPeers'
const LAB_API_ID = 'datPeers'
const LAB_PERMS_OBJ = {perm: API_PERM_ID, labApi: LAB_API_ID, apiDocsUrl: API_DOCS_URL}

// exported api
// =

module.exports = {
  async list () {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    return datExtensions.listPeers(archive)
  },

  async get (peerId) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    return datExtensions.getPeer(archive, peerId)
  },

  async broadcast (data) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    return datExtensions.broadcastEphemeralMessage(archive, data)
  },

  async send (peerId, data) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    return datExtensions.sendEphemeralMessage(archive, peerId, data)
  },

  async getSessionData () {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    return datExtensions.getSessionData(archive)
  },

  async setSessionData (sessionData) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    return datExtensions.setSessionData(archive, sessionData)
  },

  async createEventStream () {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    return datExtensions.createDatPeersStream(archive)
  }
}

// internal methods
// =

async function getSenderArchive (sender) {
  var url = sender.getURL()
  if (!url.startsWith('dat:')) {
    throw new PermissionsError('Only dat:// sites can use the datPeers API')
  }
  var urlp = parseDatURL(url)
  if (!DAT_HASH_REGEX.test(urlp.host)) {
    urlp.host = await datDns.resolveName(url)
  }
  return datLibrary.getArchive(urlp.host)
}