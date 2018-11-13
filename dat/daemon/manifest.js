module.exports = {
  setup: 'promise',
  setBandwidthThrottle: 'promise',

  createEventStream: 'readable',
  createDebugStream: 'readable',
  getDebugLog: 'promise',

  configureArchive: 'promise',
  getArchiveInfo: 'promise',
  updateSizeTracking: 'promise',

  loadArchive: 'promise',
  unloadArchive: 'promise',

  callArchiveAsyncMethod: 'async',
  callArchiveReadStreamMethod: 'readable',
  callArchiveWriteStreamMethod: 'writable',
  clearFileCache: 'promise'
}