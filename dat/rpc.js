const pda = require("pauls-dat-api")
const intoStream = require("into-stream")
const datArchive = require("../web-apis/bg/dat-archive")
const {
  PermissionsError,
  UserDeniedError,
  QuotaExceededError,
  ArchiveNotWritableError,
  InvalidURLError,
  ProtectedFileNotWritableError,
  InvalidPathError,
  TimeoutError
} = require('beaker-error-constants')

const errorPage = require("../lib/error-page")
const { PassThrough } = require("stream")

const OK = 200
const BAD_REQUEST = 400
const FORBIDDEN = 403
const REQUEST_ENTITY_TOO_LARGE = 413
const INTERNAL_SERVER_ERROR = 500
const GATEWAY_TIMEOUT = 504

const DEFAULT_HEADERS = {
  "Content-Type": "text/html",
  "Content-Security-Policy": "default-src 'unsafe-inline' beaker:;",
  "Access-Control-Allow-Origin": "*"
}

const RPC_HEADERS = {
  "Content-Type": "appliaction/json",
  "Content-Security-Policy": "default-src 'unsafe-inline' beaker:;",
  "Access-Control-Allow-Origin": "*"
}

const EVENT_STREAM_HEADERS = {
  "Content-Type": "text/event-stream",
  "Content-Security-Policy": "default-src 'unsafe-inline' beaker:;",
  "Access-Control-Allow-Origin": "*"
}

// Data send back on successful operation
const OK = { ok: true }

const toStatusCode = error => {
  if (error instanceof TimeoutError) {
    return GATEWAY_TIMEOUT
  }
  if (error instanceof PermissionsError) {
    return FORBIDDEN
  }
  if (error instanceof UserDeniedError) {
    return FORBIDDEN
  }
  if (error instanceof QuotaExceededError) {
    return REQUEST_ENTITY_TOO_LARGE
  }
  if (error instanceof ArchiveNotWritableError) {
    return FORBIDDEN
  }
  if (error instanceof InvalidURLError) {
    return BAD_REQUEST
  }
  if (error instanceof ProtectedFileNotWritableError) {
    return FORBIDDEN
  }
  if (error instanceof InvalidPathError) {
    return BAD_REQUEST
  }

  return INTERNAL_SERVER_ERROR
}


const formatError = error => ({
  statusCode: toStatusCode(error),
  headers: RPC_HEADERS,
  data: intoStream(errorPage(error.message))
})

const formatJSON = (data = OK) => ({
  statusCode: OK,
  headers: RPC_HEADERS,
  data: intoStream(JSON.stringify(data))
})

const formatEventSream = (stream) => {
  const data = new PassThrough()
  stream.on("data", json=> data.push(JSON.stringify(json)))

  return {
    statusCode:OK,
    headers:EVENT_STREAM_HEADERS,
    data
  }
}

class Options {
  constructor(query, encoding) {
    this.query = query
    this.encoding = encoding
  }
  get timeout() {
    return parseInteger(this.query.timeout)
  }
  get recursive() {
    return "recursive" in this.query
  }
  get directory() {
    return "directory" in this.query
  }
  get src() {
    return parseString(this.query.src)
  }
  get start() {
    return parseInt(this.query.start)
  }
  get end() {
    return parseInt(this.query.end)
  }
  get reverse() {
    return "reverse" in this.query
  }
  get filter() {
    return this.query.filter
  }
}

const parseInteger = input => {
  const value = parseInt(input)
  return isNaN(value) ? undefined : value
}

const parseFlag = (query, name) => name in query

const parseString = value => (typeof value === "string" ? value : undefined)

const rpcWrapperStatic = method => async request => {
  try {
    const json = await method.call(
      request,
      JSON.parse(request.uploadData.bytes.toString("utf-8"))
    )
    return formatJSON(json)
  } catch (error) {
    return formatError(error)
  }
}

const rpcWrapperWithRoot = method => async request => {
  try {
    const { query, href } = request.url
    const json = await method.call(request, href, new Options(query))
    return formatJSON(json)
  } catch (error) {
    return formatError(error)
  }
}

const rpcWrapperWithFilePath = method => async request => {
  try {
    const { url, filepath } = request
    const json = await method.call(
      request,
      url.href,
      filepath,
      new Options(url.query)
    )
    return formatJSON(json)
  } catch (error) {
    return formatError(error)
  }
}

const rpcWrapperWithSource = method => async request => {
  try {
    const { url, filepath } = request
    const options = new Options(url.query)
    const { src } = options
    const json = await method.call(request, url.href, src, filepath, options)
    return formatJSON(json)
  } catch (error) {
    return formatError(error)
  }
}

exports.getInfo = rpcWrapperWithRoot(datArchive.getInfo)
exports.history = rpcWrapperWithRoot(datArchive.history)
exports.rmdir = rpcWrapperWithFilePath(datArchive.rmdir)
exports.unlink = rpcWrapperWithFilePath(datArchive.unlink)
exports.stat = rpcWrapperWithFilePath(datArchive.stat)
exports.download = rpcWrapperWithFilePath(datArchive.download)
exports.readdir = rpcWrapperWithFilePath(datArchive.readdir)
exports.mkdir = rpcWrapperWithFilePath(datArchive.mkdir)
exports.copy = rpcWrapperWithSource(datArchive.copy)
exports.move = rpcWrapperWithSource(datArchive.move)

exports.createArchive = rpcWrapperStatic(datArchive.createArchive)
exports.selectArchive = rpcWrapperStatic(datArchive.selectArchive)
exports.resolveName = rpcWrapperStatic(datArchive.resolveName)
exports.unlinkArchive = rpcWrapperWithRoot(datArchive.unlinkArchive)

exports.configure = async request => {
  try {
    const { query, href } = request.url
    const json = await datArchive.configure.call(
      request,
      JSON.parse(request.uploadData.bytes.toString()),
      new Options(query)
    )
    return formatJSON(json)
  } catch (error) {
    return formatError(error)
  }
}

exports.writeFile = async request => {
  try {
    const { query, href } = request.url
    const { bytes } = request.uploadData
    const json = await datArchive.writeFile.call(
      request,
      request.filepath,
      bytes,
      new Options(query, "binary")
    )
    return formatJSON(json)
  } catch (error) {
    return formatError(error)
  }
}

exports.fork = sync request => {
  try {
    const { query, href } = request.url
    const json = await datArchive.fork.call(
      request,
      request.url.href,
      JSON.parse(request.uploadData.bytes.toString())
    )
    return formatJSON(json)
  } catch (error) {
    return formatError(error)
  }
}

exports.watch = async request => {
  try {
    const watcher = await datArchive.watch.call(
      request,
      new Option(request.query)
    )

    return formatEventStream(watcher)
  } catch (error) {
    return formatError(error)
  }
}