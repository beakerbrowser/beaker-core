const {getActiveArchives} = require('./library')
const datDns = require('./dns')

/**
 * @returns {string}
 */
exports.archivesDebugPage = function () {
  var archives = getActiveArchives()
  return `<html>
    <body>
      ${Object.keys(archives).map(key => {
    var a = archives[key]
    return `<div style="font-family: monospace">
          <h3>${a.key.toString('hex')}</h3>
          <table>
            <tr><td>Meta DKey</td><td>${a.discoveryKey.toString('hex')}</td></tr>
            <tr><td>Content DKey</td><td>${a.content.discoveryKey.toString('hex')}</td></tr>
            <tr><td>Meta Key</td><td>${a.key.toString('hex')}</td></tr>
            <tr><td>Content Key</td><td>${a.content.key.toString('hex')}</td></tr>
            ${a.replicationStreams.map((s, i) => `
              <tr><td>Peer ${i}</td><td>${s.peerInfo.type} ${s.peerInfo.host}:${s.peerInfo.port}</td></tr>
            `).join('')}
          </table>
        </div>`
  }).join('')}
    </body>
  </html>`
}

/**
 * @returns {string}
 */
exports.datDnsCachePage = function () {
  var cache = datDns.listCache()
  return `<html>
    <body>
      <h1>Dat DNS cache</h1>
      <p><button>Clear cache</button></p>
      <table style="font-family: monospace">
        ${Object.keys(cache).map(name => {
    var key = cache[name]
    return `<tr><td><strong>${name}</strong></td><td>${key}</td></tr>`
  }).join('')}
      </table>
      <script src="beaker://dat-dns-cache/main.js"></script>
    </body>
  </html>`
}

/**
 * @returns {string}
 */
exports.datDnsCacheJS = function () {
  return `
    document.querySelector('button').addEventListener('click', clear)
    async function clear () {
      await beaker.archives.clearDnsCache()
      location.reload()
    }
  `
}
