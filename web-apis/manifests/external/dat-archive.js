module.exports = {
  loadArchive: 'promise',
  createArchive: 'promise',
  forkArchive: 'promise',
  unlinkArchive: 'promise',

  getInfo: 'promise',
  configure: 'promise',
  history: 'promise',

  stat: 'promise',
  readFile: 'promise',
  writeFile: 'promise',
  unlink: 'promise',
  copy: 'promise',
  rename: 'promise',
  download: 'promise',

  readdir: 'promise',
  mkdir: 'promise',
  rmdir: 'promise',

  mount: 'promise',
  unmount: 'promise',

  watch: 'readable',
  createNetworkActivityStream: 'readable',

  resolveName: 'promise',
  selectArchive: 'promise',

  diff: 'promise',
  merge: 'promise',

  importFromFilesystem: 'promise',
  exportToFilesystem: 'promise',
  exportToArchive: 'promise',
}
