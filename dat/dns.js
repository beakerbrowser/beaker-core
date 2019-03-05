const parseDatURL = require('parse-dat-url')
const {InvalidDomainName} = require('beaker-error-constants')
const sitedataDb = require('../dbs/sitedata')
const {DAT_HASH_REGEX} = require('../lib/const')
const logger = require('../logger').child({category: 'dat', subcategory: 'dns'})

// instantate a dns cache and export it
const datDns = require('dat-dns')({
  persistentCache: {read, write}
})
module.exports = datDns

// hook up log events
datDns.on('resolved', details => logger.debug('Resolved', {details}))
datDns.on('failed', details => logger.debug('Failed lookup', {details}))
datDns.on('cache-flushed', details => logger.debug('Cache flushed'))

// wrap resolveName() with a better error
const resolveName = datDns.resolveName
datDns.resolveName = async function (name, opts, cb) {
  return resolveName.apply(datDns, arguments)
    .catch(_ => {
      throw new InvalidDomainName()
    })
}

// persistent cache methods
const sitedataDbOpts = {dontExtractOrigin: true}
async function read (name, err) {
  // check the cache
  var key = await sitedataDb.get('dat:' + name, 'dat-key', sitedataDbOpts)
  if (!key) throw err
  return key
}
async function write (name, key) {
  if (DAT_HASH_REGEX.test(name)) return // dont write for raw urls
  await sitedataDb.set('dat:' + name, 'dat-key', key, sitedataDbOpts)
}
