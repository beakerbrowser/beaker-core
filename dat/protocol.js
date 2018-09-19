const { join } = require("path")
const parseDatUrl = require("parse-dat-url")
const parseRange = require("range-parser")
const once = require("once")
const debug = require("../lib/debug-logger").debugLogger("dat-serve")
const pda = require("pauls-dat-api")
const intoStream = require("into-stream")
const toZipStream = require("hyperdrive-to-zip-stream")
const slugify = require("slugify")

const datDns = require("./dns")
const datLibrary = require("./library")

const directoryListingPage = require("./directory-listing-page")
const errorPage = require("../lib/error-page")
const mime = require("../lib/mime")
const { makeSafe } = require("../lib/strings")
const rpc = require("./rpc")
const { normalizeFilepath } = require("./util")
const { timer } = require("../lib/time")

// HACK detect whether the native builds of some key deps are working -prf
// -prf
try {
  require("utp-native")
} catch (err) {
  debug(
    "Failed to load utp-native. Peer-to-peer connectivity may be degraded.",
    err.toString()
  )
  console.error(
    "Failed to load utp-native. Peer-to-peer connectivity may be degraded.",
    err
  )
}
try {
  require("sodium-native")
} catch (err) {
  debug(
    "Failed to load sodium-native. Performance may be degraded.",
    err.toString()
  )
  console.error(
    "Failed to load sodium-native. Performance may be degraded.",
    err
  )
}

// constants
// =

// how long till we give up?
const REQUEST_TIMEOUT_MS = 30e3 // 30 seconds

// exported api
// =

function getReferrer() {
  return this.referrer
}

exports.electronHandler = async function(request, respond) {
  try {
    console.log(request)
    // validate request
    request.url = parseURL(request.url, true)

    // patch request so that it is compatible with `this` in dat-archive.js
    request.sender = request
    request.getURL = getReferrer

    const handler = match(request)
    const response = await handler(request)

    // const archiveKey = await resolveArchiveKey(url.host)

    // const request = new Request(url, archiveKey, request)
    // const response = await request.handle(handler)
    respond(response)
  } catch (error) {
    console.error(error)
    respond(error)
  }
}

const parseURL = url => {
  const datURL = parseDatUrl(url, true)
  if (!datURL.host) {
    throw formatError(404, "Archive Not Found", {
      validatedURL: url,
      title: "Archive Not Found",
      errorDescription: "Invalid URL",
      errorInfo: `${url} is an invalid dat:// URL`
    })
  } else {
    return datURL
  }
}

const resolveArchiveKey = async ({host, href}) => {
  // resolve the name
  // (if it's a hostname, do a DNS lookup)
  try {
    return await datDns.resolveName(host, {
      ignoreCachedMiss: true
    })
  } catch (err) {
    throw formatError(404, `No DNS record found for ${host}`, {
      validatedURL:href,
      errorDescription: "No DNS record found",
      errorInfo: `No DNS record found for dat://${host}`
    })
  }
}

const openArchive = async archiveKey => {
  try {
    // start searching the network
    return await datLibrary.getOrLoadArchive(archiveKey)
  } catch (error) {
    debug("Failed to open archive", archiveKey, error)
    throw formatError(500, "Failed")
  }
}

const getArchiveCheckout = async (archive, url, version) => {
  try {
    const { checkoutFS } = datLibrary.getArchiveCheckout(archive, version)
    return checkoutFS
  } catch (err) {
    if (err.noPreviewMode) {
      let latestUrl = makeSafe(url.replace("+preview", ""))
      throw formatError(404, "Cannot open preview", {
        validatedURL:url.href,
        title: "Cannot open preview",
        errorInfo: `You are trying to open the "preview" version of this site, but no preview exists.`,
        errorDescription: `<span>You can open the <a class="link" href="${latestUrl}">latest published version</a> instead.</span>`
      })
    } else {
      debug("Failed to open archive", archive.url, err)
      throw formatError(500, "Failed")
    }
  }
}

const checkoutArchive = async url => {
  const archiveKey = await resolveArchiveKey(url)
  const archive = await openArchive(archiveKey)
  const checkoutFS = await getArchiveCheckout(archive, url.version)
  return checkoutFS
}

const readManifest = async checkoutFS => {
  try {
    return await pda.readManifest(checkoutFS)
  } catch (e) {
    return null
  }
}

const match = request => {
  const { query, pathname } = request.url
  switch (request.method) {
    case "GET": {
      if (query.download_as === "zip") {
        return downloadZip
      } else if (query.directory) {
        return rpc.readdir
      } else if (query.watch && pathname === "/") {
        return rpc.watch
      } else if (query.history && pathname === "/") {
        return rpc.history
      } else if (query.info && pathname === "/") {
        return rpc.getInfo
      } else {
        return serveEntry
      }
    }
    case "HEAD": {
      if (query.download_as === "zip") {
        return downloadZip
      } else {
        return serveEntry
      }
    }
    case "STAT": {
      return rpc.stat
    }
    case "PUT": {
      if (query.directory) {
        return rpc.mkdir
      } else if (pathname === "/dat.json") {
        return rpc.configure
      } else {
        return rpc.writeFile
      }
    }
    case "DELETE": {
      if (query.directory) {
        return rpc.rmdir
      } else {
        return rpc.unlink
      }
    }
    case "DUPLICATE": {
      return rpc.copy
    }
    case "MOVE": {
      return rpc.move
    }
    case "HISTORY": {
      return rpc.history
    }
    case "DOWNLOAD": {
      return rpc.download
    }
    case "DESCRIBE": {
      return rpc.getInfo
    }
    default: {
      throw formatError(405, "Method Not Supported")
    }
  }
}

const selectMatchedEntry = (checkoutFS, manifest, url, paths) => {
  for (const path of paths) {
    const entry = tryEntry(checkoutFS, manifest, url, path)
    if (entry) {
      return entry
    }
  }
  return null
}

const tryEntry = async (checkoutFS, manifest, url, filename) => {
  const path = resolveEntry(manifest, url, filename)
  // attempt lookup
  try {
    const entry = await pda.stat(checkoutFS, path)
    entry.path = path
    return entry
  } catch (_) {
    return null
  }
}

const resolveEntry = (manifest, url, entry) => {
  // apply the web_root config
  if (manifest && manifest.web_root && !url.query.disable_web_root) {
    if (entry) {
      return join(manifest.web_root, entry)
    } else {
      return manifest.web_root
    }
  } else {
    return entry
  }
}

const matchEntry = async (
  checkoutFS,
  manifest,
  url,
  hasTrailingSlash,
  filepath
) => {
  const entry = hasTrailingSlash
    ? await matchDirectoryEntry(checkoutFS, manifest, url, filepath)
    : await matchFileEntry(checkoutFS, manifest, url, filepath)

  return entry || await matchFallbackEntry(checkoutFS, manifest, url)
}

const matchDirectoryEntry = (checkoutFS, manifest, url, filepath) =>
  selectMatchedEntry(checkoutFS, manifest, url, [
    `${filepath}index.html`,
    `${filepath}index.md`,
    filepath
  ])

const matchFileEntry = async (checkoutFS, manifest, url, filepath) => {
  // Fallback to .html in case corresponding file does not exist
  const entry = await selectMatchedEntry(checkoutFS, manifest, url, [
    filepath,
    `${filepath}.html"`
  ])

  // unexpected directory, give the .html fallback a chance
  if (entry && entry.isDirectory()) {
    const htmlEntry = await tryEntry(
      checkoutFS,
      manifest,
      url,
      `${filepath}.html`
    )
    return htmlEntry || entry
  }

  // no .html fallback found, stick with directory that we found
  return entry
}

const matchFallbackEntry = async (checkoutFS, manifest, url) => {
  debug("Entry not found:", url.path)

  // check for a fallback page
  const filename = manifest && manifest.fallback_page
  return filename ? await tryEntry(checkoutFS, manifest, url, filename) : null
}

const serveEntry = request =>
  timer(REQUEST_TIMEOUT_MS, async (checkin, pause, resume) => {
    const { url } = request
    checkin("looking up archive")
    const checkoutFS = await checkoutArchive(url)
    checkin("reading manifest")
    const manifest = await readManifest(checkoutFS)

    const filepath = normalizeFilepath(url.pathname)
    const hasTrailingSlash = filepath.endsWith("/")

    // lookup entry
    debug("Attempting to lookup", filepath)
    checkin(`Attempting to lookup ${filepath}`)
    const entry = await matchEntry(
      checkoutFS,
      manifest,
      url,
      hasTrailingSlash,
      filepath
    )

    if (!entry) {
      return notFound(url)
    } else if (entry.isDirectory()) {
      // make sure there's a trailing slash
      if (hasTrailingSlash) {
        const { url } = request
        const host = url.host
        const path = url.pathname || ""
        const version = url.version ? `+${url.version}` : ""
        const search = url.search || ""
        return redirect(`dat://${host}${version}${path}/${search}`)
      } else {
        checkin("formatting entry as directory listing")
        return await serveDirectory(checkoutFS, filepath, manifest)
      }
    } else {
      checkin("reading file contents")
      return await serveFile(checkoutFS, entry, manifest, request)
    }
  })

const formatZipHeaders = manifest => ({
  "Content-Type": "application/zip",
  "Content-Disposition": `attachment; filename="${formatZipName(
    manifest
  )}.zip"`,
  "Content-Security-Policy": formatCSP(manifest),
  "Access-Control-Allow-Origin": "*"
})

// (try to) get the title from the manifest
const formatZipName = manifest =>
  manifest ? slugify(manifest.title || "").toLowerCase() : "archive"

const downloadZip = request =>
  timer(REQUEST_TIMEOUT_MS, async (checkin, pause, resume) => {
    const { url } = request
    checkin("looking up archive")
    const checkoutFS = await checkoutArchive(url)
    checkin("reading manifest")
    const manifest = await readManifest(checkoutFS)
    const headers = formatZipHeaders(manifest)
    if (request.method === "HEAD") {
      return {
        statusCode: 204,
        headers,
        data: intoStream("")
      }
    } else {
      const data = toZipStream(checkoutFS, normalizeFilepath(url.pathname))
      data.on("error", err =>
        console.log("Error while producing .zip file", err)
      )
      return {
        statusCode: 200,
        headers,
        data
      }
    }
  })

const redirect = url => ({
  statusCode: 303,
  headers: {
    Location: `${url}`
  },
  data: intoStream("")
})

const notFound = url =>
  formatError(404, "File Not Found", {
    validatedURL: url.href,
    errorDescription: "File Not Found",
    errorInfo: `Beaker could not find the file ${url.path}`,
    title: "File Not Found"
  })

const serveDirectory = async (checkoutFS, filepath, manifest) => ({
  statusCode: 200,
  headers: formatEntryHeaders(manifest),
  data: intoStream(
    await directoryListingPage(
      checkoutFS,
      filepath,
      manifest && manifest.web_root
    )
  )
})

const serveFile = (checkoutFS, entry, manifest, request) =>
  new Promise(resolve => {
    // caching if-match
    // TODO
    // this unfortunately caches the CSP header too
    // we'll need the etag to change when CSP perms change
    // TODO- try including all headers...
    // -prf
    // const ETag = 'block-' + entry.content.blockOffset
    // if (request.headers['if-none-match'] === ETag) {
    //   return resolve(formatError(304, 'Not Modified'))
    // }

    // fetch the permissions
    // TODO this has been disabled until we can create a better UX -prf
    // var origins
    // try {
    //   origins = await sitedataDb.getNetworkPermissions('dat://' + archiveKey)
    // } catch (e) {
    //   origins = []
    // }

    // handle range
    const headers = {}
    headers["Accept-Ranges"] = "bytes"
    var range = request.headers.Range || request.headers.range
    if (range) range = parseRange(entry.size, range)
    if (range && range.type === "bytes") {
      range = range[0] // only handle first range given
      statusCode = 206
      headers["Content-Range"] =
        "bytes " + range.start + "-" + range.end + "/" + entry.size
      headers["Content-Length"] = range.end - range.start + 1
      debug("Serving range:", range)
    } else {
      if (entry.size) {
        headers["Content-Length"] = entry.size
      }
    }

    // fetch the entry and stream the response
    debug("Entry found:", entry.path)
    let headersSent = false
    const fileReadStream = checkoutFS.createReadStream(entry.path, range)
    request.response = fileReadStream
    const dataStream = fileReadStream.pipe(
      mime.identifyStream(entry.path, mimeType => {
        // send headers, now that we can identify the data
        headersSent = true
        Object.assign(headers, {
          "Content-Type": mimeType,
          "Referrer-Policy": "origin",
          "Content-Security-Policy": formatCSP(manifest),
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age: 60"
          // ETag
        })

        if (request.method === "HEAD") {
          dataStream.destroy() // stop reading data
          resolve({ statusCode: 204, headers, data: intoStream("") })
        } else {
          resolve({ statusCode: 200, headers, data: dataStream })
        }
      })
    )

    // handle empty files
    fileReadStream.once("end", () => {
      if (!headersSent) {
        debug("Served empty file")
        resolve({
          statusCode: 200,
          headers: {
            "Content-Security-Policy": formatCSP(manifest),
            "Access-Control-Allow-Origin": "*"
          },
          data: intoStream("")
        })
      }
    })

    // handle read-stream errors
    fileReadStream.once("error", err => {
      debug("Error reading file", err)
      if (!headersSent) {
        resolve(formatError(500, "Failed to read file"))
      }
    })
  })

const formatError = (code, status, errorPageInfo) => {
  errorPageInfo.errorCode = code
  return {
    statusCode: code,
    headers: {
      "Content-Type": "text/html",
      "Content-Security-Policy": "default-src 'unsafe-inline' beaker:;",
      "Access-Control-Allow-Origin": "*"
    },
    data: intoStream(errorPage(errorPageInfo || `${code} ${status}`))
  }
}

const formatCSP = manifest =>
  manifest && typeof manifest.content_security_policy === "string"
    ? manifest.content_security_policy
    : ""

const formatEntryHeaders = manifest => ({
  "Content-Type": "text/html",
  "Content-Security-Policy": formatCSP(manifest),
  "Access-Control-Allow-Origin": "*"
})
