/* globals Request Response */

const {EventTargetFromStream} = require('./event-target')
const errors = require('beaker-error-constants')

const experimentalLibraryManifest = require('../manifests/external/experimental/library')
const experimentalGlobalFetchManifest = require('../manifests/external/experimental/global-fetch')

exports.setup = function (rpc) {
  const experimental = {}
  const opts = {timeout: false, errors}

  // dat or internal only
  if (window.location.protocol === 'beaker:' || window.location.protocol === 'dat:') {
    const libraryRPC = rpc.importAPI('experimental-library', experimentalLibraryManifest, opts)
    const globalFetchRPC = rpc.importAPI('experimental-global-fetch', experimentalGlobalFetchManifest, opts)

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
  }

  return experimental
}
