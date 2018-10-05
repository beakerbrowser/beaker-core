const spellchecker = require('spellchecker')
const spellCheckerLib = require('../../lib/spell-checker')

let self = module.exports = {
  spellCheck(text) {
    return !self.isMisspelled(text)
  },
  isMisspelled(text) {
    const misspelled = spellchecker.isMisspelled(text)

    // Makes everything faster.
    if (!misspelled) {
      return false
    }

    // Check the locale and skip list.
    if (locale.match(/^en/) && SKIP_LIST.includes(text)) {
      return false
    }

    return true
  },
  getSuggestions(text) {
    return spellchecker.getCorrectionsForMisspelling(text)
  },
  add(text) {
    spellchecker.add(text)
  }
}