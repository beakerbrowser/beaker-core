module.exports = {
  // system state
  status: 'promise',

  // local cache management and querying
  setUserSettings: 'promise',
  add: 'promise',
  remove: 'promise',
  bulkRemove: 'promise',
  delete: 'promise',
  list: 'promise',

  // folder sync
  validateLocalSyncPath: 'promise',
  setLocalSyncPath: 'promise',
  ensureLocalSyncFinished: 'promise',

  // diff & publish
  diffLocalSyncPathListing: 'promise',
  diffLocalSyncPathFile: 'promise',
  publishLocalSyncPathListing: 'promise',
  revertLocalSyncPathListing: 'promise',

  // drafts
  getDraftInfo: 'promise',
  listDrafts: 'promise',
  addDraft: 'promise',
  removeDraft: 'promise',

  // internal management
  touch: 'promise',
  clearFileCache: 'promise',
  clearGarbage: 'promise',
  clearDnsCache: 'promise',

  // events
  createEventStream: 'readable',
  getDebugLog: 'promise',
  createDebugStream: 'readable'
}
