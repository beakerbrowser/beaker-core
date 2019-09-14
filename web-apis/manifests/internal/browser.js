module.exports = {
  createEventsStream: 'readable',
  getInfo: 'sync',
  checkForUpdates: 'promise',
  restartBrowser: 'sync',

  getUserSession: 'promise',
  setUserSession: 'promise',
  showEditProfileModal: 'promise',

  getSettings: 'promise',
  getSetting: 'promise',
  setSetting: 'promise',
  getUserSetupStatus: 'promise',
  setUserSetupStatus: 'promise',
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
  readFile: 'promise',

  getResourceContentType: 'sync',

  openSidebar: 'promise',
  toggleSidebar: 'promise',
  toggleSiteInfo: 'promise',
  toggleLiveReloading: 'promise',
  setWindowDimensions: 'promise',
  setWindowDragModeEnabled: 'promise',
  moveWindow: 'promise',
  maximizeWindow: 'promise',
  showOpenDialog: 'promise',
  showContextMenu: 'promise',
  showModal: 'promise',
  openUrl: 'promise',
  gotoUrl: 'promise',
  openFolder: 'promise',
  doWebcontentsCmd: 'promise',
  doTest: 'promise',
  closeModal: 'sync'
}
