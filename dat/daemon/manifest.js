/**
 * @typedef {import('../../dbs/archives').LibraryArchiveUserSettings} LibraryArchiveUserSettings
 *  
 * @typedef {Object} DatDaemon
 * @prop {function(DatDaemonSetupOpts): Promise<void>} setup
 * @prop {function(DatDaemonThrottleOpts): Promise<void>} setBandwidthThrottle
 * @prop {function(): NodeJS.ReadableStream} createEventStream
 * @prop {function(): NodeJS.ReadableStream} createDebugStream
 * @prop {function(string): Promise<string>} getDebugLog
 * @prop {function(string | Buffer, LibraryArchiveUserSettings): Promise<void>} configureArchive
 * @prop {function(string | Buffer): Promise<DatDaemonArchiveInfo>} getArchiveInfo
 * @prop {function(string | Buffer): Promise<number>} updateSizeTracking
 * @prop {function(DatDaemonLoadArchiveOpts): Promise<DatDaemonLoadedArchiveInfo>} loadArchive
 * @prop {function(string): Promise<void>} unloadArchive
 * @prop {function(any=, ...any=): void} callArchiveAsyncMethod
 * @prop {function(any=, ...any=): NodeJS.ReadableStream} callArchiveReadStreamMethod
 * @prop {function(any=, ...any=): NodeJS.WritableStream} callArchiveWriteStreamMethod
 * @prop {function(any=, ...any=): Promise<any>} callArchivePDAPromiseMethod
 * @prop {function(any=, ...any=): NodeJS.ReadableStream} callArchivePDAReadStreamMethod
 * @prop {function(string | Buffer, LibraryArchiveUserSettings): Promise<void>} clearFileCache
 * @prop {function(Object): Promise<Object>} exportFilesystemToArchive
 * @prop {function(Object): Promise<Object>} exportArchiveToFilesystem
 * @prop {function(Object): Promise<Object>} exportArchiveToArchive
 * @prop {function(string): Promise<void>} fs_assertSafePath
 * @prop {function(string | Buffer): Promise<void>} fs_ensureSyncFinished
 * @prop {function(string | Buffer, [DatDaemonFSDiffListingOpts]): Promise<DatDaemonFSListingDiff>} fs_diffListing
 * @prop {function(string | Buffer, string): Promise<DatDaemonFSFileDiff>} fs_diffFile
 * @prop {function(string | Buffer, DatDaemonFSQueueSyncEventOpts): Promise<void>} fe_queueSyncEvent
 * @prop {function(string | Buffer, [DatDaemonFSDiffListingOpts]): Promise<void>} fs_syncFolderToArchive
 * @prop {function(string | Buffer, [DatDaemonFSDiffListingOpts]): Promise<void>} fs_syncArchiveToFolder
 * @prop {function(any=, ...any=): Promise<any>} ext_listPeers
 * @prop {function(any=, ...any=): Promise<any>} ext_getPeer
 * @prop {function(any=, ...any=): Promise<any>} ext_broadcastEphemeralMessage
 * @prop {function(any=, ...any=): Promise<any>} ext_sendEphemeralMessage
 * @prop {function(any=, ...any=): Promise<any>} ext_getSessionData
 * @prop {function(any=, ...any=): Promise<any>} ext_setSessionData
 * @prop {function(any=, ...any=): NodeJS.ReadableStream} ext_createDatPeersStream
 * NOTE: the ext_* methods are temporary so Im not going to bother documenting their types
 * 
 * @typedef {Object} DatDaemonSetupOpts
 * @prop {string} datPath
 * @prop {string[]} disallowedSavePaths
 * 
 * @typedef {Object} DatDaemonThrottleOpts
 * @prop {number} [up]
 * @prop {number} [down]
 * 
 * @typedef {Object} DatDaemonLoadArchiveOpts
 * @prop {string | Buffer} key
 * @prop {Buffer} [secretKey]
 * @prop {string} metaPath
 * @prop {LibraryArchiveUserSettings} userSettings
 * 
 * @typedef {Object} DatDaemonFSDiffListingOpts
 * @prop {boolean} [shallow] - Dont descend into changed folders (default true)
 * @prop {boolean} [compareContent] - Compare the actual content (default true)
 * @prop {string[]} [paths] - A whitelist of files to compare
 * @prop {string} [localSyncPath] - Override the archive localSyncPath
 * @prop {boolean} [addOnly] - Dont modify or remove any files (default false)
 * 
 * @typedef {Object} DatDaemonFSQueueSyncEventOpts
 * @prop {boolean} toFolder
 * @prop {boolean} toArchive
 * 
 * @typedef {Object} DatDaemonLoadedArchiveInfo
 * @prop {Buffer} discoveryKey
 * @prop {boolean} writable
 * 
 * @typedef {never} DatDaemonPeerInfo
 * TODO- what's in here?
 * 
 * @typedef {Object} DatDaemonPeerHistory
 * @prop {number} ts
 * @prop {number} peers
 * 
 * @typedef {Object} DatDaemonNetworkStats
 * @prop {number} downloadSpeed
 * @prop {number} uploadSpeed
 * @prop {number} downloadTotal
 * @prop {number} uploadTotal
 * 
 * @typedef {Object} DatDaemonArchiveInfo
 * @prop {number} version
 * @prop {number} size
 * @prop {number} peers
 * @prop {DatDaemonPeerInfo[]} peerInfo
 * @prop {DatDaemonPeerHistory[]} peerHistory
 * @prop {DatDaemonNetworkStats} networkStats
 * 
 * @typedef {never} DatDaemonFSListingDiff
 * TODO - what's in here?
 * 
 * @typedef {never} DatDaemonFSFileDiff
 * TODO - what's in here?
 */

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
  exportFilesystemToArchive: 'async',
  exportArchiveToFilesystem: 'async',
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
