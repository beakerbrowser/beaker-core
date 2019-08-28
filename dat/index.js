module.exports = {
  archives: require('./archives'),
  assets: require('./assets'),
  debug: require('./debugging'),
  dns: require('./dns'),
  protocol: require('./protocol'),
  watchlist: require('./watchlist'),
  async setup (opts) {
    await this.archives.setup(opts)
    await this.watchlist.setup()
  }
}
