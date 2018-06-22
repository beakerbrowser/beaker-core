# Beaker Core

[Beaker browser's](https://github.com/beakerbrowser/beaker) core software. Factored out so that we can build extensions from the same codebase.

**Work in progress! Not ready to use.**

Here's how we use it in electron (the browser):

```js
import {app, protocol} from 'electron'
import beakerCore from '@beaker/core'

const DISALLOWED_SAVE_PATH_NAMES = [
  'home',
  'desktop',
  'documents',
  'downloads',
  'music',
  'pictures',
  'videos'
]

// setup beaker-core
await beakerCore.setup({
  // config
  userDataPath: app.getPath('userData'),
  homePath: app.getPath('home'),
  disallowedSavePaths: DISALLOWED_SAVE_PATH_NAMES.map(path => app.getPath(path)),

  // APIs
  permsAPI: {
    async checkLabsPerm({perm, labApi, apiDocsUrl, sender}) {/*...*/},
    async queryPermission(perm, sender) {/*...*/},
    async requestPermission(perm, sender) {/*...*/},
    async grantPermission(perm, senderURL) {/*...*/}
  },
  uiAPI: {
    async showModal(sender, modalName, opts) {/*...*/}
  },
  rpcAPI: {
    exportAPI(apiName, apiManifest, apiImpl, [guardFn])
  },
  downloadsWebAPI: {...},
  browserWebAPI: {...}
})

// setup the protocol handler
protocol.registerStreamProtocol('dat', beakerCore.dat.protocol.electronHandler, err => {
  if (err) throw ProtocolSetupError(err, 'Failed to create protocol: dat')
})
```

In the webview preload:

```js
import beakerCoreWebview from '@beaker/core/webview'

beakerCoreWebview.setup({
  // APIs
  rpcAPI: {
    importAPI(apiName, apiManifest, opts)
  }
})
```

## API (@beaker/core)

### `setup()`

### `getEnvVar()`

### `globals`

### `dbs`

### `dbs.archives`

### `dbs.bookmarks`

### `dbs.history`

### `dbs.settings`

### `dbs.sitedata`

### `dbs.templates`

### `dat`

### `dat.library`

### `dat.dns`

### `dat.folderSync`

### `dat.garbageCollector`

### `dat.protocol`

### `dat.debug`

## API (@beaker/core/webview)

### `setup()`