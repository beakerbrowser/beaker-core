const datWatchlist = require('../../dat/watchlist')
const datLibrary = require('../../dat/library')

// exported api
// =

module.exports = {
  async add (url, opts) {
    return datWatchlist.addSite(0, url, opts)
  },

  async list () {
    return datWatchlist.getSites(0)
  },

  async update (site, opts) {
    return datWatchlist.updateWatchlist(0, site, opts)
  },

  async remove (url) {
    return datWatchlist.removeSite(0, url)
  },

  // events
  // =

  createEventsStream () {
    return datWatchlist.createEventsStream()
  }
}
