const { contextBridge, webFrame } = require('electron')
const errors = require('beaker-error-constants')
const datArchiveManifest = require('../manifests/external/dat-archive')
const { exportEventStreamFn } = require('./event-target')

exports.setupAndExpose = function (rpc) {
  // create the rpc apis
  const datRPC = rpc.importAPI('dat-archive', datArchiveManifest, { timeout: false, errors })
  exportEventStreamFn(datRPC, 'watch')
  exportEventStreamFn(datRPC, 'createNetworkActivityStream')
  contextBridge.exposeInMainWorld('__dat', datRPC)

  webFrame.executeJavaScript(`
  function Stat (data) {
    if (!(this instanceof Stat)) return new Stat(data)

    this.mode = data ? data.mode : 0
    this.size = data ? data.size : 0
    this.offset = data ? data.offset : 0
    this.blocks = data ? data.blocks : 0
    this.downloaded = data ? data.downloaded : 0
    this.atime = new Date(data ? data.mtime : 0) // we just set this to mtime ...
    this.mtime = new Date(data ? data.mtime : 0)
    this.ctime = new Date(data ? data.ctime : 0)

    this.linkname = data ? data.linkname : null
  }

  Stat.IFSOCK = 49152 // 0b1100...
  Stat.IFLNK = 40960 // 0b1010...
  Stat.IFREG = 32768 // 0b1000...
  Stat.IFBLK = 24576 // 0b0110...
  Stat.IFDIR = 16384 // 0b0100...
  Stat.IFCHR = 8192 // 0b0010...
  Stat.IFIFO = 4096 // 0b0001...

  Stat.prototype.isSocket = check(Stat.IFSOCK)
  Stat.prototype.isSymbolicLink = check(Stat.IFLNK)
  Stat.prototype.isFile = check(Stat.IFREG)
  Stat.prototype.isBlockDevice = check(Stat.IFBLK)
  Stat.prototype.isDirectory = check(Stat.IFDIR)
  Stat.prototype.isCharacterDevice = check(Stat.IFCHR)
  Stat.prototype.isFIFO = check(Stat.IFIFO)

  function check (mask) {
    return function () {
      return (mask & this.mode) === mask
    }
  }



  const LISTENERS = Symbol() // eslint-disable-line
  const CREATE_STREAM = Symbol() // eslint-disable-line
  const STREAM_EVENTS = Symbol() // eslint-disable-line
  const STREAM = Symbol() // eslint-disable-line
  const PREP_EVENT = Symbol() // eslint-disable-line

  class EventTarget {
    constructor () {
      this[LISTENERS] = {}
    }

    addEventListener (type, callback) {
      if (!(type in this[LISTENERS])) {
        this[LISTENERS][type] = []
      }
      this[LISTENERS][type].push(callback)
    }

    removeEventListener (type, callback) {
      if (!(type in this[LISTENERS])) {
        return
      }
      var stack = this[LISTENERS][type]
      var i = stack.findIndex(cb => cb === callback)
      if (i !== -1) {
        stack.splice(i, 1)
      }
    }

    dispatchEvent (event) {
      if (!(event.type in this[LISTENERS])) {
        return
      }
      event.target = this
      var stack = this[LISTENERS][event.type]
      stack.forEach(cb => cb.call(this, event))
    }
  }

  class EventTargetFromStream extends EventTarget {
    constructor (createStreamFn, events, eventPrepFn) {
      super()
      this[CREATE_STREAM] = createStreamFn
      this[STREAM_EVENTS] = events
      this[PREP_EVENT] = eventPrepFn
      this[STREAM] = null
    }

    addEventListener (type, callback) {
      if (!this[STREAM]) {
        // create the event stream
        let s = this[STREAM] = fromEventStream(this[CREATE_STREAM]())
        // proxy all events
        this[STREAM_EVENTS].forEach(event => {
          s.addEventListener(event, details => {
            details = details || {}
            if (this[PREP_EVENT]) {
              details = this[PREP_EVENT](event, details)
            }
            details.target = this
            this.dispatchEvent(new Event(event, details))
          })
        })
      }
      return super.addEventListener(type, callback)
    }
  }

  class Event {
    constructor (type, opts) {
      this.type = type
      for (var k in opts) {
        this[k] = opts[k]
      }
      Object.defineProperty(this, 'bubbles', {value: false})
      Object.defineProperty(this, 'cancelBubble', {value: false})
      Object.defineProperty(this, 'cancelable', {value: false})
      Object.defineProperty(this, 'composed', {value: false})
      Object.defineProperty(this, 'currentTarget', {value: this.target})
      Object.defineProperty(this, 'deepPath', {value: []})
      Object.defineProperty(this, 'defaultPrevented', {value: false})
      Object.defineProperty(this, 'eventPhase', {value: 2}) // Event.AT_TARGET
      Object.defineProperty(this, 'timeStamp', {value: Date.now()})
      Object.defineProperty(this, 'isTrusted', {value: true})
      Object.defineProperty(this, 'createEvent', {value: () => undefined})
      Object.defineProperty(this, 'composedPath', {value: () => []})
      Object.defineProperty(this, 'initEvent', {value: () => undefined})
      Object.defineProperty(this, 'preventDefault', {value: () => undefined})
      Object.defineProperty(this, 'stopImmediatePropagation', {value: () => undefined})
      Object.defineProperty(this, 'stopPropagation', {value: () => undefined})
    }
  }

  function bindEventStream (stream, target) {
    stream.on('data', data => {
      var event = data[1] || {}
      event.type = data[0]
      target.dispatchEvent(event)
    })
  }

  function fromEventStream (stream) {
    var target = new EventTarget()
    bindEventStream(stream, target)
    target.close = () => {
      target.listeners = {}
      stream.close()
    }
    return target
  }


  const SCHEME_REGEX = /[a-z]+:\\/\\//i
  //                   1          2      3        4
  const VERSION_REGEX = /^(dat:\\/\\/)?([^/]+)(\\+[^/]+)(.*)$/i

  function parseDatURL (str, parseQS) {
    // prepend the scheme if it's missing
    if (!SCHEME_REGEX.test(str)) {
      str = 'dat://' + str
    }

    var parsed, version = null, match = VERSION_REGEX.exec(str)
    if (match) {
      // run typical parse with version segment removed
      parsed = parse((match[1] || '') + (match[2] || '') + (match[4] || ''), parseQS)
      version = match[3].slice(1)
    } else {
      parsed = parse(str, parseQS)
    }
    parsed.path = parsed.pathname // to match node
    if (!parsed.query && parsed.searchParams) {
      parsed.query = Object.fromEntries(parsed.searchParams) // to match node
    }
    parsed.version = version // add version segment
    return parsed
  }

  function parse (str) {
    return new URL(str)
  }



  const LOAD_PROMISE = Symbol('LOAD_PROMISE')
  const URL_PROMISE = Symbol('URL_PROMISE')
  const NETWORK_ACT_STREAM = Symbol() // eslint-disable-line

  class DatArchive extends EventTarget {
    constructor (url) {
      super()
      // simple case: new DatArchive(window.location)
      if (url === window.location) {
        url = window.location.toString()
      }

      // basic URL validation
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid dat:// URL')
      }

      // parse the URL
      const urlParsed = parseDatURL(url)
      if (!urlParsed || (urlParsed.protocol !== 'dat:')) {
        throw new Error('Invalid URL: must be a dat:// URL')
      }
      url = 'dat://' + urlParsed.hostname + (urlParsed.version ? ('+' + urlParsed.version) : '')

      // load into the 'active' (in-memory) cache
      setHidden(this, LOAD_PROMISE, __dat.loadArchive(url))

      // resolve the URL (DNS)
      const urlPromise = DatArchive.resolveName(url).then(url => {
        if (urlParsed.version) {
          url += '+' + urlParsed.version
        }
        return 'dat://' + url
      })
      setHidden(this, URL_PROMISE, urlPromise)

      // define this.url as a frozen getter
      Object.defineProperty(this, 'url', {
        enumerable: true,
        value: url
      })
    }

    static load (url) {
      const a = new DatArchive(url)
      return Promise.all([a[LOAD_PROMISE], a[URL_PROMISE]])
        .then(() => a)
    }

    static create (opts = {}) {
      return __dat.createArchive(opts)
        .then(newUrl => new DatArchive(newUrl))
    }

    static fork (url, opts = {}) {
      url = (typeof url.url === 'string') ? url.url : url
      if (!isDatURL(url)) {
        throw new Error('Invalid URL: must be a dat:// URL')
      }
      return __dat.forkArchive(url, opts)
        .then(newUrl => new DatArchive(newUrl))
    }

    static unlink (url) {
      url = (typeof url.url === 'string') ? url.url : url
      if (!isDatURL(url)) {
        throw new Error('Invalid URL: must be a dat:// URL')
      }
      return __dat.unlinkArchive(url)
    }

    // override to create the activity stream if needed
    addEventListener (type, callback) {
      if (type === 'network-changed' || type === 'download' || type === 'upload' || type === 'sync') {
        createNetworkActStream(this)
      }
      super.addEventListener(type, callback)
    }

    async getInfo (opts = {}) {
      var url = await this[URL_PROMISE]
      return await __dat.getInfo(url, opts)
    }

    async configure (info, opts = {}) {
      var url = await this[URL_PROMISE]
      return await __dat.configure(url, info, opts)
    }

    checkout (version) {
      const urlParsed = parseDatURL(this.url)
      version = version ? ('+' + version) : ''
      return new DatArchive('dat://' + urlParsed.hostname + version)
    }

    async diff (opts = {}) {
      // noop
      console.warn('The DatArchive diff() API has been deprecated.')
      return []
    }

    async commit (opts = {}) {
      // noop
      console.warn('The DatArchive commit() API has been deprecated.')
      return []
    }

    async revert (opts = {}) {
      // noop
      console.warn('The DatArchive revert() API has been deprecated.')
      return []
    }

    async history (opts = {}) {
      var url = await this[URL_PROMISE]
      return await __dat.history(url, opts)
    }

    async stat (path, opts = {}) {
      var url = await this[URL_PROMISE]
      return new Stat(await __dat.stat(url, path, opts))
    }

    async readFile (path, opts = {}) {
      var url = await this[URL_PROMISE]
      return await __dat.readFile(url, path, opts)
    }

    async writeFile (path, data, opts = {}) {
      var url = await this[URL_PROMISE]
      return await __dat.writeFile(url, path, data, opts)
    }

    async unlink (path, opts = {}) {
      var url = await this[URL_PROMISE]
      return await __dat.unlink(url, path, opts)
    }

    async copy (path, dstPath, opts = {}) {
      var url = await this[URL_PROMISE]
      return __dat.copy(url, path, dstPath, opts)
    }

    async rename (path, dstPath, opts = {}) {
      var url = await this[URL_PROMISE]
      return __dat.rename(url, path, dstPath, opts)
    }

    async download (path = '/', opts = {}) {
      var url = await this[URL_PROMISE]
      return await __dat.download(url, path, opts)
    }

    async readdir (path = '/', opts = {}) {
      var url = await this[URL_PROMISE]
      var names = await __dat.readdir(url, path, opts)
      if (opts.stat) {
        names.forEach(name => { name.stat = new Stat(name.stat) })
      }
      return names
    }

    async mkdir (path, opts = {}) {
      var url = await this[URL_PROMISE]
      return await __dat.mkdir(url, path, opts)
    }

    async rmdir (path, opts = {}) {
      var url = await this[URL_PROMISE]
      return await __dat.rmdir(url, path, opts)
    }

    createFileActivityStream (pathSpec = null) {
      console.warn('The DatArchive createFileActivityStream() API has been deprecated, use watch() instead.')
      return this.watch(pathSpec)
    }

    watch (pathSpec = null, onInvalidated = null) {
      // usage: (onInvalidated)
      if (typeof pathSpec === 'function') {
        onInvalidated = pathSpec
        pathSpec = null
      }

      var evts = fromEventStream(__dat.watch(this.url, pathSpec))
      if (onInvalidated) {
        evts.addEventListener('invalidated', onInvalidated)
      }
      return evts
    }

    createNetworkActivityStream () {
      console.warn('The DatArchive createNetworkActivityStream() API has been deprecated, use addEventListener() instead.')
      return fromEventStream(__dat.createNetworkActivityStream(this.url))
    }

    static async resolveName (name) {
      // simple case: DatArchive.resolveName(window.location)
      if (name === window.location) {
        name = window.location.toString()
      }
      return await __dat.resolveName(name)
    }

    static selectArchive (opts = {}) {
      return __dat.selectArchive(opts)
        .then(url => new DatArchive(url))
    }
  }

  // add internal methods
  if (window.location.protocol === 'beaker:') {
    DatArchive.importFromFilesystem = async function (opts = {}) {
      return await __dat.importFromFilesystem(opts)
    }

    DatArchive.exportToFilesystem = async function (opts = {}) {
      return await __dat.exportToFilesystem(opts)
    }

    DatArchive.exportToArchive = async function (opts = {}) {
      return await __dat.exportToArchive(opts)
    }

    DatArchive.diff = async function (srcUrl, dstUrl, opts = {}) {
      if (srcUrl && typeof srcUrl.url === 'string') srcUrl = srcUrl.url
      if (dstUrl && typeof dstUrl.url === 'string') dstUrl = dstUrl.url
      return __dat.diff(srcUrl, dstUrl, opts)
    }

    DatArchive.merge = async function (srcUrl, dstUrl, opts = {}) {
      if (srcUrl && typeof srcUrl.url === 'string') srcUrl = srcUrl.url
      if (dstUrl && typeof dstUrl.url === 'string') dstUrl = dstUrl.url
      return __dat.merge(srcUrl, dstUrl, opts)
    }
  }

  // internal methods
  // =

  function setHidden (t, attr, value) {
    Object.defineProperty(t, attr, {enumerable: false, value})
  }

  function isDatURL (url) {
    var urlp = parseDatURL(url)
    return urlp && urlp.protocol === 'dat:'
  }

  function createNetworkActStream (archive) {
    if (archive[NETWORK_ACT_STREAM]) return

    var s = archive[NETWORK_ACT_STREAM] = fromEventStream(__dat.createNetworkActivityStream(archive.url))
    s.addEventListener('network-changed', detail => archive.dispatchEvent(new Event('network-changed', {target: archive, peers: detail.connections})))
    s.addEventListener('download', detail => archive.dispatchEvent(new Event('download', {target: archive, feed: detail.feed, block: detail.block, bytes: detail.bytes})))
    s.addEventListener('upload', detail => archive.dispatchEvent(new Event('upload', {target: archive, feed: detail.feed, block: detail.block, bytes: detail.bytes})))
    s.addEventListener('sync', detail => archive.dispatchEvent(new Event('sync', {target: archive, feed: detail.feed})))
  }
  `)
}