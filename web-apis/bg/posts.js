const globals = require('../../globals')
const assert = require('assert')
const {Url} = require('url')
const {PermissionsError} = require('beaker-error-constants')
const dat = require('../../dat')
const archivesDb = require('../../dbs/archives')
const postsCrawler = require('../../crawler/posts')

// exported api
// =

module.exports = {

  async list ({offset, limit, reverse, author, authors} = {}) {
    // validate & parse params
    assert(!offset || typeof offset === 'number', 'Offset must be a number')
    assert(!limit || typeof limit === 'number', 'Limit must be a number')
    assert(!reverse || typeof reverse === 'boolean', 'Reverse must be a boolean')
    assert(!author || typeof author === 'string', 'Author must be a string')
    assert(!authors || !Array.isArray(author), 'Authors must be an array of strings')
    var posts = await postsCrawler.list({offset, limit, reverse, author, authors})
    await Promise.all(posts.map(async (post) => {
      post.author.title = await getUserTitle(post.author)
    }))
    return posts
  },

  async get (origin, pathname = undefined) {
    var post = await postsCrawler.get(origin, pathname)
    post.author.title = await getUserTitle(post.author)
    return post
  },

  async create (content) {
    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var userArchive = dat.library.getArchive(userSession.url)
    return postsCrawler.create(userArchive, content)
  },

  async edit (pathname, content) {
    assert(typeof pathname === 'string', 'Edit() must be provided a valid URL string')
    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var userArchive = dat.library.getArchive(userSession.url)
    return postsCrawler.edit(userArchive, pathname, content)
  },

  async delete (pathname) {
    assert(typeof pathname === 'string', 'Delete() must be provided a valid URL string')
    var userSession = globals.userSessionAPI.getFor(this.sender)
    if (!userSession) throw new Error('No active user session')
    var userArchive = dat.library.getArchive(userSession.url)
    return postsCrawler.delete(userArchive, pathname)
  }
}

// internal methods
// =

async function getUserTitle (author) {
  var meta = await archivesDb.getMeta(author.url.slice('dat://'.length))
  return meta ? meta.title : false
}