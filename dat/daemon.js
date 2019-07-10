const startDaemon = require('hyperdrive-daemon')
const { createMetadata } = require('hyperdrive-daemon/lib/metadata')
const { loadMetadata, HyperdriveClient } = require('hyperdrive-daemon-client')
const datEncoding = require('dat-encoding')
const pda = require('pauls-dat-api')

// constants
// =

const DAEMON_STORAGE_PATH = require('path').join(require('os').homedir(), '.dat')
const DAEMON_PORT = 3101

// typedefs
// =

/**
* @typedef {Object} DaemonDatArchive
* @prop {number} sessionId
* @prop {Buffer} key
* @prop {string} url
* @prop {boolean} writable
* @prop {Object} session
* @prop {function(): Promise<void>} session.close
* @prop {function(): Promise<void>} session.publish
* @prop {function(): Promise<void>} session.unpublish
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
  // fetch daemon metadata from disk
  var metadata
  try {
    metadata = await loadMetadata()
  } catch (e) {
    await createMetadata(`localhost:${DAEMON_PORT}`)
    metadata = await loadMetadata()
  }

  // instantiate the daemon
  // TODO the daemon should be managed in an external promise
  await startDaemon({
    storage: DAEMON_STORAGE_PATH,
    port: DAEMON_PORT,
    metadata
  })

  // TODO
  client = new HyperdriveClient(metadata.endpoint, metadata.token)
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
  const session = await client.drive.get(opts)
  const sessionId = session.id
  const key = datEncoding.toStr(opts.key)
  var datArchive = {
    key: datEncoding.toBuf(key),
    url: `dat://${key}`,
    writable: false, // TODO

    session: {
      async close () {
        return client.drive.close(sessionId)
      },
      async publish () {
        return client.drive.publish(sessionId)
      },
      async unpublish () {
        return client.drive.unpublish(sessionId)
      }
    },

    stat: (...args) => {
      // wrap the callback with a method which fixes the stat object output
      var cb = args.pop()
      args.push((err, st) => {
        if (st) fixStatObject(st)
        cb(err, st)
      })
      client.drive.stat(sessionId, ...args)
    },
    readFile: (...args) => client.drive.readFile(sessionId, ...args),
    writeFile: (...args) => client.drive.writeFile(sessionId, ...args),
    readdir: (...args) => client.drive.readdir(sessionId, ...args),
    // ready: makeArchiveProxyCbFn(key, version, 'ready'),
    // download: makeArchiveProxyCbFn(key, version, 'download'),
    // history: makeArchiveProxyReadStreamFn(key, version, 'history'),
    // createReadStream: makeArchiveProxyReadStreamFn(key, version, 'createReadStream'),
    // createDiffStream: makeArchiveProxyReadStreamFn(key, version, 'createDiffStream'),
    // createWriteStream: makeArchiveProxyWriteStreamFn(key, version, 'createWriteStream'),
    // unlink: makeArchiveProxyCbFn(key, version, 'unlink'),
    // mkdir: makeArchiveProxyCbFn(key, version, 'mkdir'),
    // rmdir: makeArchiveProxyCbFn(key, version, 'rmdir'),
    // lstat: makeArchiveProxyCbFn(key, version, 'lstat'),
    // access: makeArchiveProxyCbFn(key, version, 'access')
  }
  datArchive.pda = createDatArchiveSessionPDA(datArchive)
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
 * Provides a pauls-dat-api object for the given archive
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