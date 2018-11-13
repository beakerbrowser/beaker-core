module.exports = {
  // setup & config

  setup: 'promise',
  setBandwidthThrottle: 'promise',

  // event streams & debug

  createEventStream: 'readable',
  createDebugStream: 'readable',
  getDebugLog: 'promise',

  // archive management

  configureArchive: 'promise',
  getArchiveInfo: 'promise',
  updateSizeTracking: 'promise',
  loadArchive: 'promise',
  unloadArchive: 'promise',

  // archive methods

  callArchiveAsyncMethod: 'async',
  callArchiveReadStreamMethod: 'readable',
  callArchiveWriteStreamMethod: 'writable',
  clearFileCache: 'promise',

  // folder sync

  fs_assertSafePath: 'promise',
  fs_ensureSyncFinished: 'promise',
  fs_diffListing: 'promise',
  fs_diffFile: 'promise',
  fs_syncFolderToArchive: 'promise',
  fs_syncArchiveToFolder: 'promise'
}