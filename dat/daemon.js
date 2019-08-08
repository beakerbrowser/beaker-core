const HyperdriveDaemon = require('hyperdrive-daemon')
const { createMetadata } = require('hyperdrive-daemon/lib/metadata')
const constants = require('hyperdrive-daemon-client/lib/constants')
const { HyperdriveClient } = require('hyperdrive-daemon-client')
const datEncoding = require('dat-encoding')
const pda = require('pauls-dat-api2')

// typedefs
// =

/**
* @typedef {Object} DaemonDatArchive
* @prop {number} sessionId
* @prop {Buffer} key
* @prop {string} url
* @prop {string} domain
* @prop {boolean} writable
* @prop {Object} session
* @prop {function(): Promise<void>} session.close
* @prop {function(): Promise<void>} session.publish
* @prop {function(): Promise<void>} session.unpublish
* @prop {function(): Promise<Object>} getInfo
* @prop {function(string, Object=, Function=): any} readFile
* @prop {function(string, any, Object=, Function=): void} writeFile
* @prop {function(string, Object=, Function=): void} readdir
* @prop {DaemonDatArchivePDA} pda

* @typedef {Object} DaemonDatArchivePDA
* @prop {function(string): Promise<Object>} stat
* @prop {function(string, Object=): Promise<any>} readFile
* @prop {function(string, Object=): Promise<Array<Object>>} readdir
* @prop {function(string): Promise<number>} readSize
* @prop {function(string, any, Object=): Promise<void>} writeFile
* @prop {function(string): Promise<void>} mkdir
* @prop {function(string, string): Promise<void>} copy
* @prop {function(string, string): Promise<void>} rename
* @prop {function(string): Promise<void>} unlink
* @prop {function(string, Object=): Promise<void>} rmdir
* @prop {function(string=): Promise<void>} download
* @prop {function(string=): NodeJS.ReadableStream} watch
* @prop {function(): NodeJS.ReadableStream} createNetworkActivityStream
* @prop {function(): Promise<Object>} readManifest
* @prop {function(Object): Promise<void>} writeManifest
* @prop {function(Object): Promise<void>} updateManifest
*/

// globals
// =

var client // client object created by hyperdrive-daemon-client

// exported apis
// =

exports.setup = async function () {
  // instantiate the daemon
  // TODO the daemon should be managed in an external process
  await createMetadata(`localhost:${constants.port}`)
  var daemon = new HyperdriveDaemon()
  await daemon.start()
  process.on('exit', () => daemon.stop())

  // TODO
  client = new HyperdriveClient()
  await client.ready()
}

/**
 * Creates a dat-archive interface to the daemon for the given key
 *
 * @param {Object} opts
 * @param {Buffer} opts.key
 * @param {number} [opts.version]
 * @param {Buffer} [opts.hash]
 * @returns {Promise<DaemonDatArchive>}
 */
exports.createDatArchiveSession = async function (opts) {
  const drive = await client.drive.get(opts)
  const key = datEncoding.toStr(drive.key)
  var datArchive = {
    key: datEncoding.toBuf(key),
    url: `dat://${key}`,
    writable: drive.writable,
    domain: undefined,

    session: {
      async close () {
        return drive.close()
      },
      async publish () {
        return drive.publish()
      },
      async unpublish () {
        return drive.unpublish()
      }
    },

    async getInfo () {
      // TODO pull from daemon
      return {
        version: 0,
        size: 0,
        peers: 0,
        networkStats: {}
      }
    },
    stat: (...args) => {
      // wrap the callback with a method which fixes the stat object output
      var cb = args.pop()
      args.push((err, st) => {
        if (st) fixStatObject(st)
        cb(err, st)
      })
      drive.stat(...args)
    },
    lstat (path, opts = {}) {
      opts.lstat = true
      return this.stat(path, opts)
    },
    // readFile: (...args) => client.drive.readFile(sessionId, ...args), TODO opts not accepted by daemon yet
    readFile: (path, opts, cb) => drive.readFile(path, cb ? cb : opts),
    // writeFile: (...args) => client.drive.writeFile(sessionId, ...args), TODO encoding/opts not accepted by daemon yet
    writeFile: (path, content, opts, cb) => drive.writeFile(path, content, cb ? cb : opts),
    // download: makeArchiveProxyCbFn(key, version, 'download'),
    // history: makeArchiveProxyReadStreamFn(key, version, 'history'),
    createReadStream: (...args) => drive.createReadStream(...args),
    // createDiffStream: makeArchiveProxyReadStreamFn(key, version, 'createDiffStream'),
    createWriteStream: (...args) => drive.createWriteStream(...args),
    unlink: (...args) => drive.unlink(...args),
    readdir: (...args) => drive.readdir(...args),
    mkdir: (...args) => drive.mkdir(...args),
    rmdir: (...args) => drive.rmdir(...args),
    // access: makeArchiveProxyCbFn(key, version, 'access'),
    mount: (...args) => drive.mount(...args),
    unmount: (...args) => drive.unmount(...args),

    pda: createDatArchiveSessionPDA(drive)
  }
  return /** @type DaemonDatArchive */(datArchive)
}

// internal methods
// =

/**
 * Converts the stat object to the expected form
 * @param {Object} st
 * @returns {void}
 */
function fixStatObject (st) {
  st.atime = (new Date(st.atime)).getTime()
  st.mtime = (new Date(st.mtime)).getTime()
  st.ctime = (new Date(st.ctime)).getTime()
  st.isSocket = () => false
  st.isSymbolicLink = () => false
  st.isFile = () => (st.mode & 32768) === 32768
  st.isBlockDevice = () => false
  st.isDirectory = () => (st.mode & 16384) === 16384
  st.isCharacterDevice = () => false
  st.isFIFO = () => false
}

/**
 * Provides a pauls-dat-api2 object for the given archive
 * @param {Object} datArchive
 * @returns {DaemonDatArchivePDA}
 */
function createDatArchiveSessionPDA (datArchive) {
  var obj = {}
  for (let k in pda) {
    if (typeof pda[k] === 'function') {
      obj[k] = pda[k].bind(pda, datArchive)
    }
  }
  return obj
}