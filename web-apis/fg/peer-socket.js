const {EventTarget, Event, fromEventStream} = require('./event-target')

const LOBBY_EVENT_STREAM = new Symbol() // eslint-disable-line

module.exports = function (peerSocketRPC) {
  class PeerSocketLobby extends EventTarget {
    constructor (type, id) {
      super()
      this.id = id
      this.closed = false
      peerSocketRPC.joinLobby(type, id)

      // wire up the events
      var s = fromEventStream(peerSocketRPC.createLobbyEventStream(this.id))
      s.addEventListener('connection', ({socketInfo}) => {
        this.dispatchEvent(new Event('connection', {target: this, socket: new PeerSocket(socketInfo)}))
      })
      s.addEventListener('leave', () => {
        this.closed = true
        s.close()
        this.dispatchEvent(new Event('leave'))
      }
    }

    getSockets () {
      return Array.from(this)
    }

    leave () {
      if (!this.closed) {
        peerSocketRPC.leaveLobby(this.id)
      }
    }

    *[Symbol.iterator]() {
      var socketInfos = peerSocketRPC.getActiveConnectionsInLobby(this.id)
      for (let socketInfo of socketInfos) {
        yield new PeerSocket(socketInfo)
      }
    }
  }

  class PeerSocket extends EventTarget {
    constructor (socketInfo) {
      super()
      this.id = socketInfo.id

      // wire up the events
      var s = fromEventStream(peerSocketRPC.createSocketEventStream(this.id))
      s.addEventListener('message', ({message}) => this.dispatchEvent(new Event('message', {target: this, message})))
      s.addEventListener('close', evt => this.dispatchEvent(new Event('close', {target: this})))
    }

    // open lobby
    static joinLobby (lobbyName) {
      return new PeerSocketLobby('open', lobbyName)
    }

    // origin-specific lobby
    static joinSiteLobby () {
      return new PeerSocketLobby('origin', window.location.origin)
    }

    async send (data) {
      peerSocketRPC.socketSend(this.id, data)
    }
  }

  return PeerSocket
}