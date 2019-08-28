const ms = require('ms')

exports.LIBRARY_PATH = '/library'
exports.LIBRARY_JSON_PATH = '/library/.library.json'
exports.LIBRARY_SAVED_DAT_PATH = (cat) => `/library/${cat}`
exports.TRASH_PATH = '/trash'
exports.USERS_PATH = '/users'
exports.USER_PATH = (name) => `/users/${name}`
exports.DEFAULT_USER_PATH = '/public'
exports.USER_PUBLISHED_DAT_PATH = '/.refs/authored'

exports.TRASH_EXPIRATION_AGE = ms('7d') // how old do items need to be before deleting them from the trash?
exports.TRASH_FIRST_COLLECT_WAIT = ms('30s') // how long after process start to do first collect?
exports.TRASH_REGULAR_COLLECT_WAIT = ms('15m') // how long between collections?