/**
 * @description
 * Get the first unwalled.garden type
 * @param {string|string[]} type
 * @returns {string}
 */
const getUnwalledGardenType =
exports.getUnwalledGardenType = function (type) {
  if (typeof type === 'string') {
    type = type.split(',')
  }
  if (!type) return
  return type.find(v => v.startsWith('unwalled.garden/'))
}

/**
 * @description
 * Get a short-from of the unwalled.garden type.
 * @param {string|string[]} type
 * @returns {string}
 * @example
 *   getShortenedUnwalledGardenType('unwalled.garden/user') // 'user'
 *   getShortenedUnwalledGardenType('unwalled.garden/channel/blog') // 'channel-blog'
 *   getShortenedUnwalledGardenType('unwalled.garden/media/photo') // 'media-photo'
 */
exports.getShortenedUnwalledGardenType = function (type) {
  type = getUnwalledGardenType(type)
  if (type) {
    type = type.slice('unwalled.garden/'.length)
    return type.replace(/\//g, '-')
  }
}

/**
 * @description
 * Get the "basic type" of the dat.
 * "Basic types" are generic descriptions which are used mainly for categorization.
 * @param {string|string[]} type
 * @returns {string}
 */
exports.getBasicType = function (type) {
  type = getUnwalledGardenType(type)
  if (type) {
    if (type.startsWith('unwalled.garden/channel/')) return 'channel'
    if (type.startsWith('unwalled.garden/media/')) return 'media'
    switch (type) {
      case 'unwalled.garden/person':
      case 'unwalled.garden/organization':
      case 'unwalled.garden/project':
      case 'unwalled.garden/bot':
      case 'unwalled.garden/place':
        return 'user'
    }
  }
  return 'other'
}

/**
 * @description
 * Get a human-readable label for a dat type
 * @param {string|string[]} type
 * @returns {string}
 */
exports.getTypeLabel = function (type) {
  var t = getUnwalledGardenType(type)
  if (!t) return 'site'

  // special case some items
  if (t === 'unwalled.garden/channel/music') return 'music stream'
  if (t === 'unwalled.garden/channel/video') return 'video stream'
  if (t === 'unwalled.garden/channel/photo') return 'photo stream'

  // most other items can just extract from the type-url
  return t.split('/').pop().replace(/-/g, ' ')
}
