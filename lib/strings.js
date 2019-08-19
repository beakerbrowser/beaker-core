/* globals window */

const URL = typeof window === 'undefined' ? require('url').URL : window.URL

/**
 * Extracts the permission ID from the given permission token.
 * @param {string} permissionToken
 * @returns {string}
 */
exports.getPermId = function (permissionToken) {
  return permissionToken.split(':')[0]
}

/**
 * Extracts the permission parameter from the given permission token.
 * @param {string} permissionToken
 * @returns {string}
 */
exports.getPermParam = function (permissionToken) {
  return permissionToken.split(':').slice(1).join(':')
}

/**
 * Uppercase the first letter.
 * @param {string} str
 * @returns {string}
 */
exports.ucfirst = function (str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Makes the word plural if num !== 1.
 * @param {number} num
 * @param {string} base
 * @param {string} [suffix='s']
 * @returns {string}
 */
exports.pluralize = function (num, base, suffix = 's') {
  if (num === 1) { return base }
  return base + suffix
}

/**
 * Enforces a string length and adds ellipsis if truncation is needed.
 * @param {string} str
 * @param {number} [n = 6]
 * @returns {string}
 */
exports.shorten = function (str, n = 6) {
  if (str.length > (n + 3)) {
    return str.slice(0, n) + '...'
  }
  return str
}

/**
 * Like shorten() but for dat URLs or keys.
 * @param {string} str
 * @param {number} [n = 6]
 * @returns {string}
 */
const shortenHash = exports.shortenHash = function (str, n = 6) {
  if (str.startsWith('dat://')) {
    return 'dat://' + shortenHash(str.slice('dat://'.length).replace(/\/$/, '')) + '/'
  }
  if (str.length > (n + 5)) {
    return str.slice(0, n) + '..' + str.slice(-2)
  }
  return str
}

/**
 * Remove any markup so that an untrusted string can be safely placed inside HTML.
 * @param {string} str
 * @returns {string}
 */
exports.makeSafe = function (str) {
  return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;').replace(/"/g, '')
}

/**
 * Extracts the hostname from the given URL.
 * Will shorten the output if a dat pubkey.
 * @param {string} str
 * @returns {string}
 */
exports.getHostname = function (str) {
  try {
    const u = new URL(str)
    if (u.protocol === 'dat:' && u.hostname.length === 64) {
      return 'dat://' + shortenHash(u.hostname)
    }
    return u.hostname
  } catch (e) {
    return str
  }
}
