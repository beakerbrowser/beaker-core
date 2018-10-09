const emitStream = require('emit-stream')
const globals = require('../../../globals')
const PeerSocket = require('../../../hyperswarm/peer-socket')

// constants
// =

const API_DOCS_URL = 'https://beakerbrowser.com/docs/apis/experimental-peersocket.html'
const API_PERM_ID = 'experimentalPeerSocket'
const LAB_API_ID = 'peerSocket'
const LAB_PERMS_OBJ = {perm: API_PERM_ID, labApi: LAB_API_ID, apiDocsUrl: API_DOCS_URL}

// exported api
// =

module.exports = {
  async joinLobby (tabIdentity, lobbyType, lobbyName) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var lobby = await PeerSocket.getOrCreateLobby(this.sender, tabIdentity, lobbyType, lobbyName)
    return {
      sessionData: lobby.self.sessionData
    }
  },

  async leaveLobby (tabIdentity, lobbyType, lobbyName) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    PeerSocket.leaveLobby(this.sender, tabIdentity, lobbyType, lobbyName)
  },

  getActiveSocketsInLobby (tabIdentity, lobbyType, lobbyName) {
    // NOTE
    // this method isn't async so it can't await the perms check
    // the frontend code is constructed so that `joinLobby` has to succeed prior to this function being available
    // -prf
    var lobby = PeerSocket.getLobby(this.sender, tabIdentity, lobbyType, lobbyName)
    if (lobby) {
      return Array.from(lobby.connections).map(({id}) => ({id})) // extract only the id
    }
    return []
  },

  async setLobbySessionData (tabIdentity, lobbyType, lobbyName, sessionData) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    return PeerSocket.setLobbySessionData(this.sender, tabIdentity, lobbyType, lobbyName, sessionData)
  },

  async createLobbyEventStream (tabIdentity, lobbyType, lobbyName) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var lobby = PeerSocket.getLobby(this.sender, tabIdentity, lobbyType, lobbyName)
    if (lobby) {
      return emitStream(lobby)
    }
    throw new Error('Lobby is not active')
  },

  async socketSend (tabIdentity, lobbyType, lobbyName, socketId, content) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var conn = PeerSocket.getLobbyConnection(this.sender, tabIdentity, lobbyType, lobbyName, socketId)
    if (conn) {
      return PeerSocket.sendMessage(conn, {content})
    }
    throw new Error('Socket is closed')
  },

  async createSocketEventStream (tabIdentity, lobbyType, lobbyName, socketId) {
    await globals.permsAPI.checkLabsPerm(Object.assign({sender: this.sender}, LAB_PERMS_OBJ))
    var conn = PeerSocket.getLobbyConnection(this.sender, tabIdentity, lobbyType, lobbyName, socketId)
    if (conn) {
      return emitStream(conn.events)
    }
  }
}
