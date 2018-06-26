module.exports = {
  // system state
  status: 'promise',

  // local cache management and querying
  add: 'promise',
  remove: 'promise',
  bulkRemove: 'promise',
  delete: 'promise',
  list: 'promise',

  // folder sync
  validateLocalSyncPath: 'promise',
  setLocalSyncPath: 'promise',

  // drafts
  listDrafts: 'promise',
  setActiveDraft: 'promise',
  addDraft: 'promise',
  removeDraft: 'promise',

  // templates
  getTemplate: 'promise',
  listTemplates: 'promise',
  putTemplate: 'promise',
  removeTemplate: 'promise',

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
