const osLocale = require('os-locale')
const os = require('os')
const semver = require('semver')
const spellchecker = exports.spellchecker = require('spellchecker')

// exported api
// =

// Spellchecker thinks contractions are errors, silly spellchecker
exports.SKIP_LIST = [
    'ain',
    'couldn',
    'didn',
    'doesn',
    'hadn',
    'hasn',
    'mightn',
    'mustn',
    'needn',
    'oughtn',
    'shan',
    'shouldn',
    'wasn',
    'weren',
    'wouldn',
]

// Hunspell requires a fully-qualified locale
const locale = exports.locale = osLocale.sync().replace('-', '_')

exports.setup = function () {
    // Need to set LANG env variable so node spellcheck can find its default language
    if (!process.env.LANG) {
        process.env.LANG = locale
    }

    if (process.platform === 'linux') {
        setupLinux(locale)
    } else if (process.platform === 'win32' && semver.lt(os.release(), '8.0.0')) {
        setupWin7AndEarlier(locale)
    } else {
        // OSX and Windows 8+ have OS-level spellcheck APIs
        console.info('Using OS spell check API')
    }
}

function setupLinux (locale) {
    // Load proper dictionary for locale
    if (process.env.HUNSPELL_DICTIONARIES || locale !== 'en_US') {
        const location = process.env.HUNSPELL_DICTIONARIES || '/usr/share/hunspell'

        console.info('Detected Linux. Setting up spell check for Linux.')
        spellchecker.setDictionary(locale, location)
    } else {
        console.info('Detected Linux. Using default en_US spell check dictionary.')
    }
}

function setupWin7AndEarlier (locale) {
    // Load proper dictionary for locale
    if (process.env.HUNSPELL_DICTIONARIES || locale !== 'en_US') {
        const location = process.env.HUNSPELL_DICTIONARIES

        console.info('Detected Windows 7 or earlier. Setting up spell-check for Windows 7 or earlier.')
        spellchecker.setDictionary(locale, location)
    } else {
        console.info('Detected Windows 7 or earlier. Using default en_US spell check dictionary.')
    }
}