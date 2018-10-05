/* globals ReadableStream */

const {EventTarget, Event, fromEventStream} = require('./event-target')

const LOBBY_EVENT_STREAM = new Symbol() // eslint-disable-line

module.exports = function (peerSocketRPC) {
  var TAB_IDENT = 0
  var CAN_CHANGE_TAB_IDENT = true

  class PeerSocketLobby extends EventTarget {
    constructor (type, name) {
      super()
      setImmutableAttr(this, 'type', type)
      setImmutableAttr(this, 'name', name)
      this.closed = false

      // wire up the events
      var s = fromEventStream(peerSocketRPC.createLobbyEventStream(TAB_IDENT, this.type, this.name))
      s.addEventListener('connection', ({socketInfo}) => {
        this.dispatchEvent(new Event('connection', {target: this, socket: new PeerSocket(this, socketInfo)}))
      })
      s.addEventListener('leave', () => {
        this.closed = true
        s.close()
        this.dispatchEvent(new Event('leave'))
      })
    }

    getSockets () {
      return peerSocketRPC.getActiveSocketsInLobby(TAB_IDENT, this.type, this.name).map(si => new PeerSocket(this, si))
    }

    async leave () {
      await peerSocketRPC.leaveLobby(TAB_IDENT, this.type, this.name)
    }

    createSocketStream () {
      var connectionEventHandler
      return new ReadableStream({
        start: (controller) => {
          // handle socket events
          connectionEventHandler = e => controller.enqueue(e.socket)
          this.addEventListener('connection', connectionEventHandler)

          // push all existing sockets
          var sockets = this.getSockets()
          sockets.forEach(socket => controller.enqueue(socket))
        },
        cancel: () => {
          this.removeEventListener('connection', connectionEventHandler)
        }
      })
    }
  }

  class PeerSocket extends EventTarget {
    constructor (lobby, socketInfo) {
      super()
      setImmutableAttr(this, 'id', socketInfo.id)
      setImmutableAttr(this, 'lobby', lobby)

      // wire up the events
      var s = fromEventStream(peerSocketRPC.createSocketEventStream(TAB_IDENT, this.lobby.type, this.lobby.name, this.id))
      s.addEventListener('message', ({message}) => this.dispatchEvent(new Event('message', {target: this, message})))
      s.addEventListener('close', evt => {
        this.dispatchEvent(new Event('close', {target: this}))
        s.close()
      })
    }

    // open lobby
    static async joinOpenLobby (lobbyName) {
      // tab identities are now locked
      CAN_CHANGE_TAB_IDENT = false

      // join an instantiate
      await peerSocketRPC.joinLobby(TAB_IDENT, 'open', lobbyName)
      return new PeerSocketLobby('open', lobbyName)
    }

    // origin-specific lobby
    static async joinSiteLobby () {
      // tab identities are now locked
      CAN_CHANGE_TAB_IDENT = false

      // join an instantiate
      await peerSocketRPC.joinLobby(TAB_IDENT, 'origin', window.location.origin)
      return new PeerSocketLobby('origin', window.location.origin)
    }

    static setDebugIdentity (n) {
      if (!CAN_CHANGE_TAB_IDENT) {
        throw new Error('setDebugIdentity must be called before joining any lobbies')
      }
      TAB_IDENT = +n || 0
    }

    async send (data) {
      peerSocketRPC.socketSend(TAB_IDENT, this.lobby.type, this.lobby.name, this.id, data)
    }

    createMessageStream () {
      var messageEventHandler
      return new ReadableStream({
        start: (controller) => {
          messageEventHandler = e => controller.enqueue(e.message)
          this.addEventListener('message', messageEventHandler)
        },
        cancel: () => {
          this.removeEventListener('message', messageEventHandler)
        }
      })
    }
  }

  function setImmutableAttr (obj, name, value) {
    Object.defineProperty(obj, name, {
      value,
      enumerable: true,
      writable: false
    })
  }

  return PeerSocket
}
