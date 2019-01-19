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
  callArchivePDAPromiseMethod: 'promise',
  callArchivePDAReadStreamMethod: 'readable',
  clearFileCache: 'promise',
  exportArchiveToArchive: 'async',

  // folder sync

  fs_assertSafePath: 'promise',
  fs_ensureSyncFinished: 'promise',
  fs_diffListing: 'promise',
  fs_diffFile: 'promise',
  fe_queueSyncEvent: 'promise',
  fs_syncFolderToArchive: 'promise',
  fs_syncArchiveToFolder: 'promise',

  // dat extensions

  ext_listPeers: 'promise',
  ext_getPeer: 'promise',
  ext_getOwnPeerId: 'promise',
  ext_broadcastEphemeralMessage: 'promise',
  ext_sendEphemeralMessage: 'promise',
  ext_getSessionData: 'promise',
  ext_setSessionData: 'promise',
  ext_createDatPeersStream: 'readable'
}
