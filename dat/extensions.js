const EventEmitter = require('events')
const emitStream = require('emit-stream')
const {DatSessionDataExtMsg} = require('@beaker/dat-session-data-ext-msg')
const {DatEphemeralExtMsg} = require('@beaker/dat-ephemeral-ext-msg')

// globals
// =

var datSessionDataExtMsg = new DatSessionDataExtMsg()
var datEphemeralExtMsg = new DatEphemeralExtMsg()

// exported api
// =

function setup () {
  datEphemeralExtMsg.on('message', onEphemeralMsg)
  datSessionDataExtMsg.on('session-data', onSessionDataMsg)
}
exports.setup = setup

// call this on every archive created in the library
function attach (archive) {
  datEphemeralExtMsg.watchDat(archive)
  datSessionDataExtMsg.watchDat(archive)
  archive._datPeersEvents = new EventEmitter()
  archive._datPeersOnPeerAdd = (peer) => onPeerAdd(archive, peer)
  archive._datPeersOnPeerRemove = (peer) => onPeerRemove(archive, peer)
  archive.metadata.on('peer-add', archive._datPeersOnPeerAdd)
  archive.metadata.on('peer-remove', archive._datPeersOnPeerRemove)
}
exports.attach = attach

// call this on every archive destroyed in the library
function detach (archive) {
  datEphemeralExtMsg.unwatchDat(archive)
  datSessionDataExtMsg.unwatchDat(archive)
  delete archive._datPeersEvents
  archive.metadata.removeListener('peer-add', archive._datPeersOnPeerAdd)
  archive.metadata.removeListener('peer-remove', archive._datPeersOnPeerRemove)
}
exports.detach = detach

// impl for datPeers.list()
function listPeers (archive) {
  return archive.metadata.peers.map(internalPeerObj => createWebAPIPeerObj(archive, internalPeerObj))
}
exports.listPeers = listPeers

// impl for datPeers.getPeer(peerId)
function getPeer (archive, peerId) {
  var internalPeerObj = archive.metadata.peers.find(internalPeerObj => getPeerId(internalPeerObj) === peerId)
  return createWebAPIPeerObj(archive, internalPeerObj)
}
exports.getPeer = getPeer

// impl for datPeers.broadcast(msg)
function broadcastEphemeralMessage (archive, payload) {
  datEphemeralExtMsg.broadcast(archive, encodeEphemeralMsg(payload))
}
exports.broadcastEphemeralMessage = broadcastEphemeralMessage

// impl for datPeers.send(peerId, msg)
function sendEphemeralMessage (archive, peerId, payload) {
  datEphemeralExtMsg.send(archive, peerId, encodeEphemeralMsg(payload))
}
exports.sendEphemeralMessage = sendEphemeralMessage

// impl for datPeers.getSessionData()
function getSessionData (archive) {
  return decodeSessionData(datSessionDataExtMsg.getLocalSessionData(archive))
}
exports.getSessionData = getSessionData

// impl for datPeers.getSessionData(data)
function setSessionData (archive, sessionData) {
  datSessionDataExtMsg.setLocalSessionData(archive, encodeSessionData(sessionData))
}
exports.setSessionData = setSessionData

function createDatPeersStream (archive) {
  return emitStream(archive._datPeersEvents)
}
exports.createDatPeersStream = createDatPeersStream

// events
// =

function onPeerAdd (archive, internalPeerObj) {
  if (getPeerId(internalPeerObj)) onHandshook()
  else internalPeerObj.stream.stream.on('handshake', onHandshook)

  function onHandshook () {
    var peerId = getPeerId(internalPeerObj)

    // send session data
    if (datSessionDataExtMsg.getLocalSessionData(archive)) {
      datSessionDataExtMsg.sendLocalSessionData(archive, peerId)
    }

    // emit event
    archive._datPeersEvents.emit('connect', {
      peerId,
      sessionData: getPeerSessionData(archive, peerId)
    })
  }
}

function onPeerRemove (archive, internalPeerObj) {
  var peerId = getPeerId(internalPeerObj)
  if (peerId) {
    archive._datPeersEvents.emit('disconnect', {
      peerId,
      sessionData: getPeerSessionData(archive, peerId)
    })
  }
}

function onEphemeralMsg (archive, internalPeerObj, msg) {
  var peerId = getPeerId(internalPeerObj)
  archive._datPeersEvents.emit('message', {
    peerId,
    sessionData: getPeerSessionData(archive, peerId),
    message: decodeEphemeralMsg(msg)
  })
}

function onSessionDataMsg (archive, internalPeerObj, sessionData) {
  archive._datPeersEvents.emit('session-data', {
    peerId: getPeerId(internalPeerObj),
    sessionData: decodeSessionData(sessionData)
  })
}

// internal methods
// =

function getPeerId (internalPeerObj) {
  var feedStream = internalPeerObj.stream
  var protocolStream = feedStream.stream
  return protocolStream.remoteId ? protocolStream.remoteId.toString('hex') : null
}

function getPeerSessionData (archive, peerId) {
  return decodeSessionData(datSessionDataExtMsg.getSessionData(archive, peerId))
}

function createWebAPIPeerObj (archive, internalPeerObj) {
  var id = getPeerId(internalPeerObj)
  var sessionData = getPeerSessionData(archive, id)
  return {id, sessionData}
}

function encodeEphemeralMsg (payload) {
  var contentType
  if (Buffer.isBuffer(payload)) {
    contentType = 'application/octet-stream'
  } else {
    contentType = 'application/json'
    payload = Buffer.from(JSON.stringify(payload), 'utf8')
  }
  return {contentType, payload}
}

function decodeEphemeralMsg (msg) {
  var payload
  if (msg.contentType === 'application/json') {
    try {
      payload = JSON.parse(msg.payload.toString('utf8'))
    } catch (e) {
      console.error('Failed to parse ephemeral message', e, msg)
      payload = null
    }
  }
  return payload
}

function encodeSessionData (obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8')
}

function decodeSessionData (sessionData) {
  if (!sessionData || sessionData.length === 0) return null
  try {
    return JSON.parse(sessionData.toString('utf8'))
  } catch (e) {
    console.error('Failed to parse local session data', e, sessionData)
    return null
  }
}
