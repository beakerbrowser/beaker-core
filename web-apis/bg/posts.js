const globals = require('../../globals')
const assert = require('assert')
const {Url} = require('url')
const {PermissionsError} = require('beaker-error-constants')
const dat = require('../../dat')
const postsCrawler = require('../../crawler/posts')

// exported api
// =

module.exports = {

  async list ({offset, limit, reverse, author} = {}) {
    // validate & parse params
    assert(!offset || typeof offset === 'number', 'Offset must be a number')
    assert(!limit || typeof limit === 'number', 'Limit must be a number')
    assert(!reverse || typeof reverse === 'boolean', 'Reverse must be a boolean')
    assert(!author || typeof author === 'string', 'Author must be a string')
    if (author) {
      try { author = new URL(author) }
      catch (e) { throw new Error('Failed to parse author URL: ' + author) }
    }
    return postsCrawler.list({offset, limit, reverse, author})
  },

  async get (origin, pathname = undefined) {
    return postsCrawler.get(origin, pathname)
  },

  async create ({content} = {}) {
    assert(typeof content === 'string', 'Create() must be provided a `content` string')
    var userSession = globals.getUserSessionFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var userArchive = dat.library.getArchive(userSession.url)
    return postsCrawler.create(userArchive, {content})
  },

  async edit (pathname, {content} = {}) {
    assert(typeof pathname === 'string', 'Edit() must be provided a valid URL string')
    assert(typeof content === 'string', 'Edit() must be provided a `content` string')
    var userSession = globals.getUserSessionFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var userArchive = dat.library.getArchive(userSession.url)
    return postsCrawler.edit(userArchive, pathname, {content})
  },

  async delete (pathname) {
    assert(typeof pathname === 'string', 'Edit() must be provided a valid URL string')
    var userSession = globals.getUserSessionFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var userArchive = dat.library.getArchive(userSession.url)
    return postsCrawler.delete(userArchive, pathname)
  }
}