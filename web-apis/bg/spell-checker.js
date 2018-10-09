const spellCheckerLib = require('../../lib/spell-checker')

let self = module.exports = {
  spellCheck (text) {
    return !self.isMisspelled(text)
  },
  isMisspelled (text) {
    const misspelled = spellCheckerLib.spellchecker.isMisspelled(text)

    // Makes everything faster.
    if (!misspelled) {
      return false
    }

    // Check the locale and skip list.
    if (spellCheckerLib.locale.match(/^en/) && spellCheckerLib.SKIP_LIST.includes(text)) {
      return false
    }

    return true
  },
  getSuggestions (text) {
    return spellCheckerLib.spellchecker.getCorrectionsForMisspelling(text)
  },
  add (text) {
    spellCheckerLib.spellchecker.add(text)
  }
}
