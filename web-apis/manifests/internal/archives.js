module.exports = {
  // system state
  status: 'promise',

  // local cache management and querying
  list: 'promise',
  configure: 'promise',
  delete: 'promise',

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
