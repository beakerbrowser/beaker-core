const EventEmitter = require('events')
const createHyperswarmNetwork = require('@hyperswarm/network')
const lpstream = require('length-prefixed-stream')
const pump = require('pump')
const sodium = require('sodium-universal')
const schemas = require('./peer-socket-schemas')
const {extractOrigin} = require('../lib/strings')

// constants
// =

const {MESSAGE, SESSION_DATA} = PeerSocket.schemas.PeerSocketMessageType

// globals
// =

var swarms = new Map() // origin -> hyperswarm net instance

// exported APIs
// =

module.exports = {
  getSwarm,
  getOrCreateSwarm,
  
  getLobby,
  getOrCreateLobby,
  leaveLobby,
  getLobbyConnection,

  sendMessage,
  sendSessionData,

  encodeMsg,
  decodeMsg,
  schemas
}

function getSwarm (sender, tabIdentity) {
  return swarms.get(getSwarmId(sender, tabIdentity))
}

function getOrCreateSwarm (sender, tabIdentity) {
  var swarm = getSwarm(sender, tabIdentity)
  if (!swarm) swarm = createSwarm(sender, tabIdentity)
  return swarm
}

function getLobby (sender, tabIdentity, lobbyType, lobbyName) {
  var swarm = getSwarm(sender, tabIdentity)
  if (swarm) {
    var topic = createLobbyTopic(lobbyType, lobbyName)
    return swarm.lobbies.get(topic.toString('hex'))
  }
}

function getOrCreateLobby (sender, tabIdentity, lobbyType, lobbyName) {
  var swarm = getOrCreateSwarm(sender, tabIdentity)
  if (swarm) {
    var topic = createLobbyTopic(lobbyType, lobbyName)
    if (!swarm.lobbies.has(topic.toString('hex'))) {
      // create the lobby
      var lobby = Object.assign(new EventEmitter(), {
        topic,
        name: lobbyName,
        type: lobbyType,
        connections: new Set(),
        connIdCounter: 0
      })
      swarm.lobbies.set(topic.toString('hex'), lobby)

      // join the swarm topic
      swarm.join(topic, {lookup: true, announce: true})
    }
    return swarm.lobbies.get(topic.toString('hex'))
  }
}

function leaveLobby (sender, tabIdentity, lobbyType, lobbyName) {
  var swarm = getSwarm(sender, tabIdentity)
  if (swarm) {
    var topic = createLobbyTopic(lobbyType, lobbyName)
    var lobby = swarm.lobbies.get(topic.toString('hex'))
    if (lobby) {
      // leave the swarm topic and close all connections
      lobby.connections.forEach(({socket}) => socket.close())
      swarm.leave(topic)
      lobby.emit('leave')
      swarm.lobbies.delete(topic.toString('hex'))
    }
  }
}

function getLobbyConnection (sender, tabIdentity, lobbyType, lobbyName, socketId) {
  var lobby = getLobby(sender, tabIdentity, lobbyType, lobbyName)
  if (lobby) {
    return Array.from(lobby.connections).find(({id}) => id === socketId)
  }
}

function sendMessage (conn, content) {
  return new Promise((resolve, reject) => {
    conn.encoder.write(PeerSocket.encodeMsg({messageType: MESSAGE, content}), err => {
      if (err) {
        console.error('Error writing to PeerSocket', err)
        reject(new Error('Failed to send message'))
      } else {
        resolve()
      }
    })
  })
}

function sendSessionData (conn, sessionData) {
  return new Promise((resolve, reject) => {
    conn.encoder.write(PeerSocket.encodeMsg({messageType: SESSION_DATA, content}), err => {
      if (err) {
        console.error('Error writing to PeerSocket', err)
        reject(new Error('Failed to send message'))
      } else {
        resolve()
      }
    })
  })
}

function encodeMsg ({messageType, content}) {
  var contentType
  if (Buffer.isBuffer(content)) {
    contentType = 'application/octet-stream'
  } else {
    contentType = 'application/json'
    content = Buffer.from(JSON.stringify(content), 'utf8')
  }
  return schemas.PeerSocketMessage.encode({messageType, content, contentType})
}

function decodeMsg (msg) {
  msg = schemas.PeerSocketMessage.decode(msg)
  if (msg.contentType === 'application/json') {
    try {
      msg.content = JSON.parse(msg.content.toString('utf8'))
    } catch (e) {
      console.error('Failed to parse PeerSocket message', e, msg)
      msg.content = null
    }
  }
  return msg
}

// internal methods
// =

function createLobbyTopic (lobbyType, lobbyName) {
  var out = Buffer.allocUnsafe(32)
  sodium.crypto_generichash(out, Buffer.from(`peersocket-${lobbyType}-${lobbyName}`, 'utf8'))
  return out
}

function getSwarmId (sender, tabIdentity) {
  var id = extractOrigin(sender.getURL())
  if (tabIdentity) {
    id += '::' + tabIdentity
  }
  return id
}

function createSwarm (sender, tabIdentity) {
  let swarmId = getSwarmId(sender, tabIdentity)
  var swarm = createHyperswarmNetwork({ephemeral: true})
  swarms.set(swarmId, swarm)
  swarm.lobbies = new Map()

  // handle connection events
  swarm.on('connection', (socket, details) => {
    handleConnection(swarm, socket, details)
  })
  return swarm
}

function handleConnection (swarm, socket, details) {
  var topic
  if (!details.peer) {
    // DEBUG HACK
    // if no peer info is available, fallback to the first available lobby
    // this MUST BE FIXED upstream prior to merging
    // -prf
    topic = Array.from(swarm.lobbies.keys())[0]
  } else {
    topic = details.peer.topic.toString('hex')
  }
  var lobby = swarm.lobbies.get(topic)
  if (lobby) {
    // create the connection
    var id = ++lobby.connIdCounter
    var encoder = lpstream.encode()
    var decoder = lpstream.decode()
    var conn = {
      id,
      socket,
      details,
      encoder,
      decoder,
      events: new EventEmitter()
    }
    lobby.connections.add(conn)
    lobby.emit('connection', {socketInfo: {id}})

    // wire up events
    decoder.on('data', message => {
      try {
        message = decodeMsg(message)
        switch (message.messageType) {
          case schemas.PeerSocketMessageType.MESSAGE:
            conn.events.emit('message', {message: message.content})
            break
          case schemas.PeerSocketMessageType.SESSION_DATA:
            // TODO
            break
          default:
            throw new Error('Unknown message type: ' + message.messageType)
        }
      } catch (e) {
        console.log('Failed to decode received PeerSocket message', e)
      }
    })

    // wire up message-framers and handle close
    pump(encoder, socket, decoder, err => {
      if (err) console.log('PeerSocket connection error', err)
      lobby.connections.remove(conn)
      conn.events.emit('close')
    })
  }
}
