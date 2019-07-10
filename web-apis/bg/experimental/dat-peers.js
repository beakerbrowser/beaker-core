const parseDatURL = require('parse-dat-url')
const {PermissionsError} = require('beaker-error-constants')
const globals = require('../../../globals')
const datLibrary = require('../../../dat/library')
const datDns = require('../../../dat/dns')
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
    // TODO return datLibrary.getDaemon().ext_listPeers(archive.key.toString('hex'))
  },

  async get (peerId) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    // TODO return datLibrary.getDaemon().ext_getPeer(archive.key.toString('hex'), peerId)
  },

  async broadcast (data) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    // TODO return datLibrary.getDaemon().ext_broadcastEphemeralMessage(archive.key.toString('hex'), data)
  },

  async send (peerId, data) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    // TODO return datLibrary.getDaemon().ext_sendEphemeralMessage(archive.key.toString('hex'), peerId, data)
  },

  async getSessionData () {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    // TODO return datLibrary.getDaemon().ext_getSessionData(archive.key.toString('hex'))
  },

  async setSessionData (sessionData) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    // TODO return datLibrary.getDaemon().ext_setSessionData(archive.key.toString('hex'), sessionData)
  },

  async createEventStream () {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var archive = await getSenderArchive(this.sender)
    // TODO return datLibrary.getDaemon().ext_createDatPeersStream(archive.key.toString('hex'))
  },

  async getOwnPeerId () {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    // TODO return datLibrary.getDaemon().ext_getOwnPeerId()
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
