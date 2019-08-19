const templatesDb = require('../../dbs/templates')

// exported api
// =

module.exports = {
  async get (url) {
    return templatesDb.get(0, url)
  },

  async list () {
    return templatesDb.list(0)
  },

  async put (url, {title, screenshot}) {
    return templatesDb.put(0, url, {title, screenshot})
  },

  async remove (url) {
    return templatesDb.remove(0, url)
  }
}