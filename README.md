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
  templatesPath: path.join(__dirname, 'assets', 'templates'),
  disallowedSavePaths: DISALLOWED_SAVE_PATH_NAMES.map(path => app.getPath(path)),

  // APIs
  permsAPI: {
    async checkLabsPerm({perm, labApi, apiDocsUrl, sender}) {/*...*/},
    async queryPermission(perm, sender) {/*...*/},
    async requestPermission(perm, sender) {/*...*/},
    async grantPermission(perm, senderURL) {/*...*/}
  },
  uiAPI: {
    async showModal(sender, modalName, opts) {/*...*/},
    async capturePage(url, opts) {/*...*/}
  },
  rpcAPI: {
    exportAPI(apiName, apiManifest, apiImpl, [guardFn])
  },
  downloadsWebAPI: {...},
  browserWebAPI: {...},
  userSessionAPI: {
    getFor(webContents) {/*...*/}
  }
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

### `debugLogger(name)`

```js
import {debugLogger} from '@beaker/core'
const debug = debugLogger('dat')

// write to the debug log under 'dat'
debug('dat-related stuff')
```

### `getLogFilePath()`

### `getLogFileContent(start, end)`

### `globals`

### `dbs`

### `dbs.archives`

### `dbs.history`

### `dbs.settings`

### `dbs.sitedata`

### `dat`

### `dat.library`

### `dat.dns`

### `dat.protocol`

### `dat.debug`

### `uwg`

### `users`

## API (@beaker/core/webview)

### `setup()`