module.exports = {
  setup: 'promise',
  createEventStream: 'readable',
  configureArchive: 'promise',
  setBandwidthThrottle: 'promise',
  getDebugLog: 'promise',
  loadArchive: 'promise',
  unloadArchive: 'promise',
  callArchiveAsyncMethod: 'async',
  callArchiveReadStreamMethod: 'readable',
  callArchiveWriteStreamMethod: 'writable',
  clearFileCache: 'promise'
}