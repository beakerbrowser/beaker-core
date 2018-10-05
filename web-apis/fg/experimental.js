/* globals Request Response */

const {EventTargetFromStream} = require('./event-target')
const errors = require('beaker-error-constants')

const experimentalLibraryManifest = require('../manifests/external/experimental/library')
const experimentalGlobalFetchManifest = require('../manifests/external/experimental/global-fetch')
const experimentalCapturePageManifest = require('../manifests/external/experimental/capture-page')
const experimentalDatPeersManifest = require('../manifests/external/experimental/dat-peers')
const experimentalPeerSocketManifest = require('../manifests/external/experimental/peer-socket')

const createPeerSocketAPI = require('./peer-socket')

exports.setup = function (rpc) {
  const experimental = {}
  const opts = {timeout: false, errors}

  // dat or internal only
  if (window.location.protocol === 'beaker:' || window.location.protocol === 'dat:') {
    const libraryRPC = rpc.importAPI('experimental-library', experimentalLibraryManifest, opts)
    const globalFetchRPC = rpc.importAPI('experimental-global-fetch', experimentalGlobalFetchManifest, opts)
    const capturePageRPC = rpc.importAPI('experimental-capture-page', experimentalCapturePageManifest, opts)
    const datPeersRPC = rpc.importAPI('experimental-dat-peers', experimentalDatPeersManifest, opts)
    const peerSocketRPC = rpc.importAPI('experimental-peer-socket', experimentalPeerSocketManifest, opts)

    // experimental.library
    let libraryEvents = ['added', 'removed', 'updated', 'folder-synced', 'network-changed']
    experimental.library = new EventTargetFromStream(libraryRPC.createEventStream.bind(libraryRPC), libraryEvents)
    experimental.library.add = libraryRPC.add
    experimental.library.remove = libraryRPC.remove
    experimental.library.get = libraryRPC.get
    experimental.library.list = libraryRPC.list
    experimental.library.requestAdd = libraryRPC.requestAdd
    experimental.library.requestRemove = libraryRPC.requestRemove

    // experimental.globalFetch
    experimental.globalFetch = async function globalFetch (input, init) {
      var request = new Request(input, init)
      if (request.method !== 'HEAD' && request.method !== 'GET') {
        throw new Error('Only HEAD and GET requests are currently supported by globalFetch()')
      }
      var responseData = await globalFetchRPC.fetch({
        method: request.method,
        url: request.url,
        headers: request.headers
      })
      return new Response(responseData.body, responseData)
    }

    // experimental.capturePage
    experimental.capturePage = capturePageRPC.capturePage

    // experimental.datPeers
    class DatPeer {
      constructor (id, sessionData) {
        this.id = id
        this.sessionData = sessionData
      }
      send (data) {
        datPeersRPC.send(this.id, data)
      }
    }
    const prepDatPeersEvents = (event, details) => {
      var peer = new DatPeer(details.peerId, details.sessionData)
      delete details.peerId
      delete details.sessionData
      details.peer = peer
      return details
    }
    const datPeersEvents = ['connect', 'message', 'session-data', 'disconnect']
    experimental.datPeers = new EventTargetFromStream(datPeersRPC.createEventStream.bind(datPeersRPC), datPeersEvents, prepDatPeersEvents)
    experimental.datPeers.list = async () => {
      var peers = await datPeersRPC.list()
      return peers.map(p => new DatPeer(p.id, p.sessionData))
    }
    experimental.datPeers.get = async (peerId) => {
      var {sessionData} = await datPeersRPC.get(peerId)
      return new DatPeer(peerId, sessionData)
    }
    experimental.datPeers.broadcast = datPeersRPC.broadcast
    experimental.datPeers.getSessionData = datPeersRPC.getSessionData
    experimental.datPeers.setSessionData = datPeersRPC.setSessionData

    // experimental.PeerSocket
    experimental.PeerSocket = createPeerSocketAPI(peerSocketRPC)
  }

  return experimental
}
