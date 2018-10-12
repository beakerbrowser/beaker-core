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

  async remove (url, opts) {
    return datWatchlist.removeSite(0, url, opts)
  },

  // events
  // =

  createEventsStream () {
    return datWatchlist.createEventsStream()
  }
}
