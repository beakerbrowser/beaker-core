const bytes = require('bytes')
const ms = require('ms')

// native FS file paths
exports.ANALYTICS_DATA_FILE = 'analytics-ping.json'
exports.ANALYTICS_SERVER = 'analytics.beakerbrowser.com'
exports.ANALYTICS_CHECKIN_INTERVAL = ms('1w')

// hyperdrive FS file paths
exports.PATHS = {
  // common
  DATA: '/.data',
  DATA_NS: (ns) => `/.data/${ns}`,

  // private fs
  DEFAULT_USER: '/public',
  LIBRARY: '/.library',
  LIBRARY_JSON: '/.library/library.json',
  LIBRARY_SAVED_DAT: (cat) => `/.library/${cat}`,
  USERS: '/.users',
  USER: (name) => `/.users/${name}`,
  TRASH: '/.trash',

  // public fs
  REFS_FOLLOWED_DATS: '/.refs/follows',
}

// hyperdrive trash management
exports.TRASH_EXPIRATION_AGE = ms('7d') // how old do items need to be before deleting them from the trash?
exports.TRASH_FIRST_COLLECT_WAIT = ms('30s') // how long after process start to do first collect?
exports.TRASH_REGULAR_COLLECT_WAIT = ms('15m') // how long between collections?

// 64 char hex
exports.DAT_HASH_REGEX = /^[0-9a-f]{64}$/i
exports.DAT_URL_REGEX = /^(?:dat:\/\/)?([0-9a-f]{64})/i

// url file paths
exports.DAT_VALID_PATH_REGEX = /^[a-z0-9\-._~!$&'()*+,;=:@/\s]+$/i
exports.INVALID_SAVE_FOLDER_CHAR_REGEX = /[^0-9a-zA-Z-_ ]/g

// dat settings
exports.DAT_SWARM_PORT = 3282
exports.DAT_MANIFEST_FILENAME = 'dat.json'
let quotaEnvVar = process.env.BEAKER_DAT_QUOTA_DEFAULT_BYTES_ALLOWED || process.env.beaker_dat_quota_default_bytes_allowed
exports.DAT_QUOTA_DEFAULT_BYTES_ALLOWED = bytes.parse(quotaEnvVar || '500mb')
exports.DAT_CACHE_TIME = ms('7d')
exports.DEFAULT_DAT_DNS_TTL = ms('1h')
exports.MAX_DAT_DNS_TTL = ms('7d')
exports.DEFAULT_DAT_API_TIMEOUT = ms('5s')
// dat.json manifest fields which can be changed by configure()
exports.DAT_CONFIGURABLE_FIELDS = [
  'title',
  'description',
  'type',
  'author',
  'links',
  'web_root',
  'fallback_page'
]
// dat.json manifest fields which should be preserved in forks
exports.DAT_PRESERVED_FIELDS_ON_FORK = [
  'web_root',
  'fallback_page',
  'links',
  'experimental',
  'content_security_policy'
]

// workspace settings
exports.WORKSPACE_VALID_NAME_REGEX = /^[a-z][a-z0-9-]*$/i

// git-url validator
exports.IS_GIT_URL_REGEX = /(?:git|ssh|https?|git@[-\w.]+):(\/\/)?(.*?)(\.git)(\/?|#[-\d\w._]+?)$/
