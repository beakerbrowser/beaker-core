const _groupBy = require('lodash.groupby')
const bookmarksDb = require('../dbs/bookmarks')
const historyDb = require('../dbs/history')
const datLibrary = require('../dat/library')
const {getBasicType} = require('../lib/dat')

const BUILTIN_PAGES = [
  {title: 'Timeline', url: 'beaker://timeline'},
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

  // library
  var libraryResults = await datLibrary.queryArchives({isSaved: true})
  libraryResults = libraryResults.filter(filterFn)
  Object.assign(suggestions, _groupBy(libraryResults, a => getBasicType(a.type)))

  if (query) {
    // bookmarks
    var bookmarkResults = await bookmarksDb.listBookmarks(0)
    if (opts.filterPins) {
      bookmarkResults = bookmarkResults.filter(b => !b.pinned && filterFn(b))
    } else {
      bookmarkResults = bookmarkResults.filter(filterFn)
    }
    bookmarkResults = bookmarkResults.slice(0, 12)
    suggestions.bookmarks = bookmarkResults.map(b => ({title: b.title, url: b.href}))

    // history
    var historyResults = await historyDb.search(query)
    suggestions.history = historyResults.slice(0, 12)
    suggestions.history.sort((a, b) => a.url.length - b.url.length) // shorter urls at top
  }

  return suggestions
}
