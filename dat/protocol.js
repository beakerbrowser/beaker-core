const {extname} = require('path')
const parseDatUrl = require('parse-dat-url')
const parseRange = require('range-parser')
const once = require('once')
const logger = require('../logger').child({category: 'dat', subcategory: 'dat-serve'})
const intoStream = require('into-stream')
const {toZipStream} = require('../lib/zip')
const slugify = require('slugify')
const markdown = require('../lib/markdown')

const datDns = require('./dns')
const datLibrary = require('./library')
const datServeResolvePath = require('@beaker/dat-serve-resolve-path')

const errorPage = require('../lib/error-page')
const mime = require('../lib/mime')
const {makeSafe} = require('../lib/strings')

// HACK detect whether the native builds of some key deps are working -prf
// -prf
var utpLoadError = false
try { require('utp-native') }
catch (err) {
  utpLoadError = err
}
var sodiumLoadError = false
try { require('sodium-native') }
catch (err) {
  sodiumLoadError = err
}

// constants
// =

// how long till we give up?
const REQUEST_TIMEOUT_MS = 30e3 // 30 seconds

// exported api
// =

exports.electronHandler = async function (request, respond) {
  // log warnings now, after the logger has setup its transports
  if (utpLoadError) {
    logger.warn('Failed to load utp-native. Peer-to-peer connectivity may be degraded.', {err: utpLoadError.toString()})
  }
  if (sodiumLoadError) {
    logger.warn('Failed to load sodium-native. Performance may be degraded.', {err: sodiumLoadError.toString()})
  }

  respond = once(respond)
  var respondError = (code, status, errorPageInfo) => {
    if (errorPageInfo) {
      errorPageInfo.validatedURL = request.url
      errorPageInfo.errorCode = code
    }
    var accept = request.headers.Accept || ''
    if (accept.includes('text/html')) {
      respond({
        statusCode: code,
        headers: {
          'Content-Type': 'text/html',
          'Content-Security-Policy': "default-src 'unsafe-inline' beaker:;",
          'Access-Control-Allow-Origin': '*'
        },
        data: intoStream(errorPage(errorPageInfo || (code + ' ' + status)))
      })
    } else {
      respond({statusCode: code})
    }
  }
  var fileReadStream
  var headersSent = false
  var archive
  var cspHeader = ''

  // validate request
  var urlp = parseDatUrl(request.url, true)
  if (!urlp.host) {
    return respondError(404, 'Archive Not Found', {
      title: 'Archive Not Found',
      errorDescription: 'Invalid URL',
      errorInfo: `${request.url} is an invalid dat:// URL`
    })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return respondError(405, 'Method Not Supported')
  }

  // resolve the name
  // (if it's a hostname, do a DNS lookup)
  try {
    var archiveKey = await datDns.resolveName(urlp.host, {ignoreCachedMiss: true})
  } catch (err) {
    return respondError(404, 'No DNS record found for ' + urlp.host, {
      errorDescription: 'No DNS record found',
      errorInfo: `No DNS record found for dat://${urlp.host}`
    })
  }

  // setup a timeout
  var timeout
  const cleanup = () => clearTimeout(timeout)
  timeout = setTimeout(() => {
    // cleanup
    logger.debug('Timed out searching for', {url: archiveKey})
    if (fileReadStream) {
      fileReadStream.destroy()
      fileReadStream = null
    }

    // error page
    var resource = archive ? 'page' : 'site'
    respondError(504, `Timed out searching for ${resource}`, {
      resource,
      validatedURL: urlp.href
    })
  }, REQUEST_TIMEOUT_MS)

  try {
    // start searching the network
    archive = await datLibrary.getOrLoadArchive(archiveKey)
  } catch (err) {
    logger.warn('Failed to open archive', {url: archiveKey, err})
    cleanup()
    return respondError(500, 'Failed')
  }

  // parse path
  var filepath = decodeURIComponent(urlp.path)
  if (!filepath) filepath = '/'
  if (filepath.indexOf('?') !== -1) filepath = filepath.slice(0, filepath.indexOf('?')) // strip off any query params
  var hasTrailingSlash = filepath.endsWith('/')

  // checkout version if needed
  try {
    var {checkoutFS} = await datLibrary.getArchiveCheckout(archive, urlp.version)
    if (urlp.version === 'preview') {
      await checkoutFS.pda.stat('/') // run a stat to ensure preview mode exists
    }
  } catch (err) {
    if (err.noPreviewMode) {
      // redirect to non-preview version
      return respond({
        statusCode: 303,
        headers: {
          Location: `dat://${urlp.host}${urlp.pathname || '/'}${urlp.search || ''}`
        },
        data: intoStream('')
      })
    } else {
      logger.warn('Failed to open archive checkout', {url: archiveKey, err})
      cleanup()
      return respondError(500, 'Failed')
    }
  }

  // read the manifest (it's needed in a couple places)
  var manifest
  try { manifest = await checkoutFS.pda.readManifest() } catch (e) { manifest = null }

  // read manifest CSP
  if (manifest && manifest.content_security_policy && typeof manifest.content_security_policy === 'string') {
    cspHeader = manifest.content_security_policy
  }

  // handle zip download
  if (urlp.query.download_as === 'zip') {
    cleanup()

    // (try to) get the title from the manifest
    let zipname = false
    if (manifest) {
      zipname = slugify(manifest.title || '').toLowerCase()
    }
    zipname = zipname || 'archive'

    let headers = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipname}.zip"`,
      'Content-Security-Policy': cspHeader,
      'Access-Control-Allow-Origin': '*'
    }

    if (request.method === 'HEAD') {
      // serve the headers
      return respond({
        statusCode: 204,
        headers,
        data: intoStream('')
      })
    } else {
      // serve the zip
      var zs = toZipStream(checkoutFS, filepath)
      zs.on('error', err => logger.error('Error while producing .zip file', err))
      return respond({
        statusCode: 200,
        headers,
        data: zs
      })
    }
  }

  // lookup entry
  var statusCode = 200
  var headers = {}
  var entry = await datServeResolvePath(checkoutFS.pda, manifest, urlp, request.headers.Accept)

  // use theme template if it exists
  var themeSettings = {
    active: false,
    js: false,
    css: false
  }
  if (!urlp.query.disable_theme) {
    if (entry && mime.acceptHeaderWantsHTML(request.headers.Accept) && ['.html', '.htm', '.md'].includes(extname(entry.path))) {
      let exists = async (path) => await checkoutFS.pda.stat(path).then(() => true, () => false)
      let [js, css] = await Promise.all([exists('/theme/index.js'), exists('/theme/index.css')])
      if (js || css) {
        themeSettings.active = true
        themeSettings.css = css
        themeSettings.js = js
      }
    }
  }

  // handle folder
  if (entry && entry.isDirectory()) {
    cleanup()

    // make sure there's a trailing slash
    if (!hasTrailingSlash) {
      return respond({
        statusCode: 303,
        headers: {
          Location: `dat://${urlp.host}${urlp.version ? ('+' + urlp.version) : ''}${urlp.pathname || ''}/${urlp.search || ''}`
        },
        data: intoStream('')
      })
    }

    // 404
    entry = null
  }

  // handle not found
  if (!entry) {
    cleanup()
    return respondError(404, 'File Not Found', {
      errorDescription: 'File Not Found',
      errorInfo: `Beaker could not find the file ${urlp.path}`,
      title: 'File Not Found'
    })
  }

  // TODO
  // Electron is being really aggressive about caching and not following the headers correctly
  // caching is disabled till we can figure out why
  // -prf
  // caching if-match
  // const ETag = (checkoutFS.isLocalFS) ? false : 'block-' + entry.offset
  // if (request.headers['if-none-match'] === ETag) {
  //   return respondError(304, 'Not Modified')
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
  headers['Accept-Ranges'] = 'bytes'
  var range = request.headers.Range || request.headers.range
  if (range) range = parseRange(entry.size, range)
  if (range && range.type === 'bytes') {
    range = range[0] // only handle first range given
    statusCode = 206
    headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + entry.size
    headers['Content-Length'] = range.end - range.start + 1
  } else {
    if (entry.size) {
      headers['Content-Length'] = entry.size
    }
  }

  Object.assign(headers, {
    'Content-Security-Policy': cspHeader,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  })

  // markdown rendering
  if (!range && entry.path.endsWith('.md') && mime.acceptHeaderWantsHTML(request.headers.Accept)) {
    let content = await checkoutFS.pda.readFile(entry.path, 'utf8')
    return respond({
      statusCode: 200,
      headers: Object.assign(headers, {
        'Content-Type': 'text/html'
      }),
      data: intoStream(markdown.render(content, themeSettings))
    })
  }

  // theme wrapping
  if (themeSettings.active) {
    let html = await checkoutFS.pda.readFile(entry.path, 'utf8')
    html = `
${themeSettings.js ? `<script type="module" src="/theme/index.js"></script>` : ''}
${themeSettings.css ? `<link rel="stylesheet" href="/theme/index.css">` : ''}
${html}`
    return respond({
      statusCode: 200,
      headers: Object.assign(headers, {
        'Content-Type': 'text/html'
      }),
      data: intoStream(html)
    })
  }

  // TODO
  // replace this with createReadStream when that method is available
  var content = await checkoutFS.pda.readFile(entry.path)
  Object.assign(headers, {
    'Content-Type': mime.identify(entry.path)
  })
  respond({statusCode, headers, data: intoStream(content)})
  cleanup()
  return

  // fetch the entry and stream the response
  fileReadStream = checkoutFS.createReadStream(entry.path, range)
  var dataStream = fileReadStream
    .pipe(mime.identifyStream(entry.path, mimeType => {
      // cleanup the timeout now, as bytes have begun to stream
      cleanup()

      // send headers, now that we can identify the data
      headersSent = true
      Object.assign(headers, {
        'Content-Type': mimeType
      })
      // TODO
      // Electron is being really aggressive about caching and not following the headers correctly
      // caching is disabled till we can figure out why
      // -prf
      // if (ETag) {
      //   Object.assign(headers, {ETag})
      // } else {
      //   Object.assign(headers, {'Cache-Control': 'no-cache'})
      // }

      if (request.method === 'HEAD') {
        dataStream.destroy() // stop reading data
        respond({statusCode: 204, headers, data: intoStream('')})
      } else {
        respond({statusCode, headers, data: dataStream})
      }
    }))

  // handle empty files
  fileReadStream.once('end', () => {
    if (!headersSent) {
      cleanup()
      respond({
        statusCode: 200,
        headers: {
          'Content-Security-Policy': cspHeader,
          'Access-Control-Allow-Origin': '*'
        },
        data: intoStream('')
      })
    }
  })

  // handle read-stream errors
  fileReadStream.once('error', err => {
    logger.warn('Error reading file', {url: archive.url, path: entry.path, err})
    if (!headersSent) respondError(500, 'Failed to read file')
  })
}
