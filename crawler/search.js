const bookmarksDb = require('../dbs/bookmarks')
const historyDb = require('../dbs/history')
const datLibrary = require('../dat/library')

const BUILTIN_PAGES = [
  {title: 'Feed', url: 'beaker://feed'},
  {title: 'Library', url: 'beaker://library'},
  {title: 'Search', url: 'beaker://search'},
  {title: 'Bookmarks', url: 'beaker://bookmarks'},
  {title: 'History', url: 'beaker://history'},
  {title: 'Watchlist', url: 'beaker://watchlist'},
  {title: 'Downloads', url: 'beaker://downloads'},
  {title: 'Settings', url: 'beaker://settings'},
]

// exported api
// =

exports.listSuggestions = async function (query = '', opts = {}) {
  var suggestions = {}
  const filterFn = a => ((a.url || a.href).includes(query) || a.title.toLowerCase().includes(query))

  // builtin pages
  suggestions.apps = BUILTIN_PAGES.filter(filterFn)

  // bookmarks
  var bookmarkResults = await bookmarksDb.listBookmarks(0)
  if (opts.filterPins) {
    bookmarkResults = bookmarkResults.filter(b => !b.pinned && filterFn(b))
  } else {
    bookmarkResults = bookmarkResults.filter(filterFn)
  }
  bookmarkResults = bookmarkResults.slice(0, 12)
  suggestions.bookmarks = bookmarkResults.map(b => ({title: b.title, url: b.href}))

  // library
  var libraryResults = await datLibrary.queryArchives({isSaved: true})
  libraryResults = libraryResults.filter(filterFn)
  suggestions.library = libraryResults.slice(0, 12)

  // fetch history
  if (query) {
    var historyResults = await historyDb.search(query)
    suggestions.history = historyResults.slice(0, 12)
    suggestions.history.sort((a, b) => a.url.length - b.url.length) // shorter urls at top
  }

  return suggestions
}
