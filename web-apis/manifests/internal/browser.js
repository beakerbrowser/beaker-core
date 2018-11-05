module.exports = {
  createEventsStream: 'readable',
  getInfo: 'sync',
  checkForUpdates: 'promise',
  restartBrowser: 'sync',

  getSettings: 'promise',
  getSetting: 'promise',
  setSetting: 'promise',
  getUserSetupStatus: 'promise',
  setUserSetupStatus: 'promise',
  getDefaultLocalPath: 'promise',
  setStartPageBackgroundImage: 'promise',
  getDefaultProtocolSettings: 'promise',
  setAsDefaultProtocolClient: 'promise',
  removeAsDefaultProtocolClient: 'promise',

  listBuiltinFavicons: 'promise',
  getBuiltinFavicon: 'promise',
  uploadFavicon: 'promise',
  imageToIco: 'promise',

  fetchBody: 'promise',
  downloadURL: 'promise',

  getResourceContentType: 'sync',

  setWindowDimensions: 'promise',
  showOpenDialog: 'promise',
  showContextMenu: 'promise',
  openUrl: 'promise',
  openFolder: 'promise',
  doWebcontentsCmd: 'promise',
  doTest: 'promise',
  closeModal: 'sync'
}
