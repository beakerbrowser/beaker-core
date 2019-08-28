const assert = require('assert')
const {URL} = require('url')
const Events = require('events')
const Ajv = require('ajv')
const logger = require('../logger').child({category: 'uwg', dataset: 'comments'})
const db = require('../dbs/profile-data-db')
const uwg = require('./index')
const datArchives = require('../dat/archives')
const lock = require('../lib/lock')
const knex = require('../lib/knex')
const siteDescriptions = require('./site-descriptions')
const {
  doCrawl,
  doCheckpoint,
  emitProgressEvent,
  getMatchingChangesInOrder,
  generateTimeFilename,
  ensureDirectory,
  normalizeTopicUrl
} = require('./util')
const commentSchema = require('./json-schemas/comment')

// constants
// =

const TABLE_VERSION = 1
const JSON_TYPE = 'unwalled.garden/comment'
const JSON_PATH_REGEX = /^\/data\/comments\/([^/]+)\.json$/i

// typedefs
// =

/**
 * @typedef {import('../dat/daemon').DaemonDatArchive} DaemonDatArchive
 * @typedef {import('./util').CrawlSourceRecord} CrawlSourceRecord
 * @typedef { import("./site-descriptions").SiteDescription } SiteDescription
 *
 * @typedef {Object} Comment
 * @prop {string} pathname
 * @prop {string} topic
 * @prop {string} replyTo
 * @prop {string} body
 * @prop {string} createdAt
 * @prop {string} updatedAt
 * @prop {SiteDescription} author
 * @prop {string} visibility
 *
 * @typedef {Object} ThreadedComment
 * @prop {string} pathname
 * @prop {string} topic
 * @prop {string} replyTo
 * @prop {ThreadedComment[]} replies
 * @prop {number} replyCount
 * @prop {string} body
 * @prop {string} createdAt
 * @prop {string} updatedAt
 * @prop {SiteDescription} author
 * @prop {string} visibility
 */

// globals
// =

const events = new Events()
const ajv = (new Ajv())
const validateComment = ajv.compile(commentSchema)

// exported api
// =

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @description
 * Crawl the given site for comments.
 *
 * @param {DaemonDatArchive} archive - site to crawl.
 * @param {CrawlSourceRecord} crawlSource - internal metadata about the crawl target.
 * @returns {Promise}
 */
exports.crawlSite = async function (archive, crawlSource) {
  return doCrawl(archive, crawlSource, 'crawl_comments', TABLE_VERSION, async ({changes, resetRequired}) => {
    const supressEvents = resetRequired === true // dont emit when replaying old info
    logger.silly('Crawling comments', {details: {url: archive.url, numChanges: changes.length, resetRequired}})
    if (resetRequired) {
      // reset all data
      logger.debug('Resetting dataset', {details: {url: archive.url}})
      await db.run(`
        DELETE FROM crawl_comments WHERE crawlSourceId = ?
      `, [crawlSource.id])
      await doCheckpoint('crawl_comments', TABLE_VERSION, crawlSource, 0)
    }

    // collect changed comments
    var changedComments = getMatchingChangesInOrder(changes, JSON_PATH_REGEX)
    if (changedComments.length) {
      logger.verbose('Collected new/changed comment files', {details: {url: archive.url, changedComments: changedComments.map(p => p.name)}})
    } else {
      logger.debug('No new comment-files found', {details: {url: archive.url}})
    }
    emitProgressEvent(archive.url, 'crawl_comments', 0, changedComments.length)

    // read and apply each comment in order
    var progress = 0
    for (let changedComment of changedComments) {
      // TODO Currently the crawler will abort reading the feed if any comment fails to load
      //      this means that a single unreachable file can stop the forward progress of comment indexing
      //      to solve this, we need to find a way to tolerate unreachable comment-files without losing our ability to efficiently detect new comments
      //      -prf
      if (changedComment.type === 'del') {
        // delete
        await db.run(`
          DELETE FROM crawl_comments WHERE crawlSourceId = ? AND pathname = ?
        `, [crawlSource.id, changedComment.name])
        events.emit('comment-removed', archive.url)
      } else {
        // read
        let commentString
        try {
          commentString = await archive.pda.readFile(changedComment.name, 'utf8')
        } catch (err) {
          logger.warn('Failed to read comment file, aborting', {details: {url: archive.url, name: changedComment.name, err}})
          return // abort indexing
        }

        // parse and validate
        let comment
        try {
          comment = JSON.parse(commentString)
          let valid = validateComment(comment)
          if (!valid) throw ajv.errorsText(validateComment.errors)
        } catch (err) {
          logger.warn('Failed to parse comment file, skipping', {details: {url: archive.url, name: changedComment.name, err}})
          continue // skip
        }

        // massage the comment
        comment.topic = normalizeTopicUrl(comment.topic)
        comment.repliesTo = comment.repliesTo ? normalizeTopicUrl(comment.repliesTo) : ''
        comment.createdAt = Number(new Date(comment.createdAt))
        comment.updatedAt = Number(new Date(comment.updatedAt))
        if (isNaN(comment.updatedAt)) comment.updatedAt = 0 // optional

        // upsert
        let existingComment = await get(joinPath(archive.url, changedComment.name))
        if (existingComment) {
          await db.run(`
            UPDATE crawl_comments
              SET crawledAt = ?, topic = ?, replyTo = ?, body = ?, createdAt = ?, updatedAt = ?
              WHERE crawlSourceId = ? AND pathname = ?
          `, [Date.now(), comment.topic, comment.replyTo, comment.body, comment.createdAt, comment.updatedAt, crawlSource.id, changedComment.name])
          events.emit('comment-updated', archive.url)
        } else {
          await db.run(`
            INSERT INTO crawl_comments (crawlSourceId, pathname, crawledAt, topic, replyTo, body, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [crawlSource.id, changedComment.name, Date.now(), comment.topic, comment.replyTo, comment.body, comment.createdAt, comment.updatedAt])
          events.emit('comment-added', archive.url)
        }
      }

      // checkpoint our progress
      await doCheckpoint('crawl_comments', TABLE_VERSION, crawlSource, changedComment.version)
      emitProgressEvent(archive.url, 'crawl_comments', ++progress, changedComments.length)
    }
    logger.silly(`Finished crawling comments`, {details: {url: archive.url}})
  })
}

/**
 * @description
 * List crawled comments.
 *
  * @param {Object} [opts]
  * @param {Object} [opts.filters]
  * @param {string|string[]} [opts.filters.authors]
  * @param {string|string[]} [opts.filters.topics]
  * @param {string} [opts.filters.visibility]
  * @param {string} [opts.sortBy]
  * @param {number} [opts.offset=0]
  * @param {number} [opts.limit]
  * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Comment>>}
 */
exports.list = async function (opts) {
  // TODO: handle visibility
  // TODO: sortBy options

  // validate & parse params
  if (opts && 'sortBy' in opts) assert(typeof opts.sortBy === 'string', 'SortBy must be a string')
  if (opts && 'offset' in opts) assert(typeof opts.offset === 'number', 'Offset must be a number')
  if (opts && 'limit' in opts) assert(typeof opts.limit === 'number', 'Limit must be a number')
  if (opts && 'reverse' in opts) assert(typeof opts.reverse === 'boolean', 'Reverse must be a boolean')
  if (opts && opts.filters) {
    if ('authors' in opts.filters) {
      if (Array.isArray(opts.filters.authors)) {
        assert(opts.filters.authors.every(v => typeof v === 'string'), 'Authors filter must be a string or array of strings')
      } else {
        assert(typeof opts.filters.authors === 'string', 'Authors filter must be a string or array of strings')
        opts.filters.authors = [opts.filters.authors]
      }
      opts.filters.authors = await Promise.all(opts.filters.authors.map(datArchives.getPrimaryUrl))
    }
    if ('topics' in opts.filters) {
      if (Array.isArray(opts.filters.topics)) {
        assert(opts.filters.topics.every(v => typeof v === 'string'), 'Topics filter must be a string or array of strings')
      } else {
        assert(typeof opts.filters.topics === 'string', 'Topics filter must be a string or array of strings')
        opts.filters.topics = [opts.filters.topics]
      }
      opts.filters.topics = opts.filters.topics.map(normalizeTopicUrl)
    }
    if ('visibility' in opts.filters) {
      assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
    }
  }

  // build query
  var sql = knex('crawl_comments')
    .select('crawl_comments.*')
    .select('crawl_sources.url AS crawlSourceUrl')
    .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_comments.crawlSourceId')
    .orderBy('crawl_comments.createdAt', opts.reverse ? 'DESC' : 'ASC')
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }
  if (opts && opts.filters && opts.filters.topics) {
    sql = sql.whereIn('crawl_comments.topic', opts.filters.topics)
  }
  if (opts && opts.limit) sql = sql.limit(opts.limit)
  if (opts && opts.offset) sql = sql.offset(opts.offset)

  // execute query
  var rows = await db.all(sql)
  return Promise.all(rows.map(massageCommentRow))
}

/**
 * @description
 * List crawled comments.
 * @param {string} topic
 * @param {Object} [opts]
 * @param {Object} [opts.filters]
 * @param {string|string[]} [opts.filters.authors]
 * @param {string} [opts.filters.visibility]
 * @param {string} [opts.parent]
 * @param {number} [opts.depth]
 * @param {string} [opts.sortBy]
 * @param {boolean} [opts.reverse]
 * @returns {Promise<Array<Comment>>}
 */
exports.thread = async function (topic, opts) {
  // TODO: handle visibility
  // TODO: sortBy options

  // validate & parse params
  assert(typeof topic === 'string', 'Topic must be a URL string')
  topic = normalizeTopicUrl(topic)
  if (opts && 'parent' in opts) {
    assert(typeof opts.parent === 'string', 'Parent must be a string')
    opts.parent = normalizeTopicUrl(opts.parent)
  }
  if (opts && 'depth' in opts) assert(typeof opts.depth === 'number', 'Depth must be a number')
  if (opts && 'sortBy' in opts) assert(typeof opts.sortBy === 'string', 'SortBy must be a string')
  if (opts && 'reverse' in opts) assert(typeof opts.reverse === 'boolean', 'Reverse must be a boolean')
  if (opts && opts.filters) {
    if ('authors' in opts.filters) {
      if (Array.isArray(opts.filters.authors)) {
        assert(opts.filters.authors.every(v => typeof v === 'string'), 'Authors filter must be a string or array of strings')
      } else {
        assert(typeof opts.filters.authors === 'string', 'Authors filter must be a string or array of strings')
        opts.filters.authors = [opts.filters.authors]
      }
      opts.filters.authors = await Promise.all(opts.filters.authors.map(datArchives.getPrimaryUrl))
    }
    if ('visibility' in opts.filters) {
      assert(typeof opts.filters.visibility === 'string', 'Visibility filter must be a string')
    }
  }

  // build query
  var sql = knex('crawl_comments')
    .select('crawl_comments.*')
    .select('crawl_sources.url AS crawlSourceUrl')
    .where('crawl_comments.topic', topic)
    .innerJoin('crawl_sources', 'crawl_sources.id', '=', 'crawl_comments.crawlSourceId')
    .orderBy('crawl_comments.createdAt', opts.reverse ? 'DESC' : 'ASC')
  if (opts && opts.filters && opts.filters.authors) {
    sql = sql.whereIn('crawl_sources.url', opts.filters.authors)
  }

  // execute query
  var rows = await db.all(sql)

  // create a map of comments by their URL
  var commentsByUrl = {}
  rows.forEach(row => { commentsByUrl[joinPath(row.crawlSourceUrl, row.pathname)] = row })

  // attach each comment to its parent, forming a tree
  var rootComments = []
  rows.forEach(row => {
    if (row.replyTo) {
      let parent = commentsByUrl[row.replyTo]
      if (!parent) {
        // TODO insert a placeholder parent when not found
        // something that means "this post was by somebody you dont follow"
        // -prf
        return
      }
      if (!parent.replies) {
        parent.replies = []
        parent.replyCount = 0
      }
      parent.replies.push(row)
      parent.replyCount++
    } else {
      rootComments.push(row)
    }
  })

  // apply the parent filter
  if (opts && opts.parent) {
    rootComments = []
    rows.forEach(row => {
      if (row.replyTo === opts.parent) {
        rootComments.push(row)
      }
    })
  }

  // apply the depth limit
  if (opts && opts.depth) {
    let recursiveApplyDepth = (currentDepth, comment) => {
      if (!comment.replies) return
      if (currentDepth === opts.depth) {
        comment.replies = null
      } else {
        comment.replies.forEach(reply => recursiveApplyDepth(currentDepth + 1, reply))
      }
    }
    rootComments.forEach(comment => recursiveApplyDepth(1, comment))
  }

  return Promise.all(rootComments.map(massageThreadedCommentRow))
}

/**
 * @description
 * Get crawled comment.
 *
 * @param {string} url - The URL of the comment
 * @returns {Promise<Comment>}
 */
const get = exports.get = async function (url) {
  // validate & parse params
  var urlParsed
  if (url) {
    try { urlParsed = new URL(url) }
    catch (e) { throw new Error('Invalid URL: ' + url) }
  }

  // execute query
  var sql = knex('crawl_comments')
    .select('crawl_comments.*')
    .select('crawl_sources.url AS crawlSourceUrl')
    .innerJoin('crawl_sources', function () {
      this.on('crawl_sources.id', '=', 'crawl_comments.crawlSourceId')
        .andOn('crawl_sources.url', '=', knex.raw('?', `${urlParsed.protocol}//${urlParsed.hostname}`))
    })
    .where('crawl_comments.pathname', urlParsed.pathname)
  return await massageCommentRow(await db.get(sql))
}

/**
 * @description
 * Create a new comment.
 *
 * @param {DaemonDatArchive} archive - where to write the comment to.
 * @param {string} topic
 * @param {Object} comment
 * @param {string} comment.replyTo
 * @param {string} comment.body
 * @param {string} comment.visibility
 * @returns {Promise<string>} url
 */
exports.add = async function (archive, topic, comment) {
  // TODO visibility

  var commentObject = {
    type: JSON_TYPE,
    topic: normalizeTopicUrl(topic),
    replyTo: comment.replyTo ? normalizeTopicUrl(comment.replyTo) : undefined,
    body: comment.body,
    createdAt: (new Date()).toISOString()
  }
  var valid = validateComment(commentObject)
  if (!valid) throw ajv.errorsText(validateComment.errors)

  var filename = generateTimeFilename()
  var filepath = `/data/comments/${filename}.json`
  await ensureDirectory(archive, '/data')
  await ensureDirectory(archive, '/data/comments')
  await archive.pda.writeFile(filepath, JSON.stringify(commentObject, null, 2))
  await uwg.crawlSite(archive)
  return archive.url + filepath
}

/**
 * @description
 * Update the content of an existing comment.
 *
 * @param {DaemonDatArchive} archive - where to write the comment to.
 * @param {string} pathname - the pathname of the comment.
 * @param {Object} comment
 * @param {string} [comment.replyTo]
 * @param {string} [comment.body]
 * @param {string} [comment.visibility]
 * @returns {Promise<void>}
 */
exports.edit = async function (archive, pathname, comment) {
  // TODO visibility

  var release = await lock('crawler:comments:' + archive.url)
  try {
    // fetch comment
    var existingComment = await get(archive.url + pathname)
    if (!existingComment) throw new Error('Comment not found')

    // update comment content
    var commentObject = {
      type: JSON_TYPE,
      topic: normalizeTopicUrl(existingComment.topic),
      replyTo: ('replyTo' in comment) ? normalizeTopicUrl(comment.replyTo) : existingComment.replyTo,
      body: ('body' in comment) ? comment.body : existingComment.body,
      createdAt: existingComment.createdAt,
      updatedAt: (new Date()).toISOString()
    }

    // validate
    var valid = validateComment(commentObject)
    if (!valid) throw ajv.errorsText(validateComment.errors)

    // write
    await archive.pda.writeFile(pathname, JSON.stringify(commentObject, null, 2))
    await uwg.crawlSite(archive)
  } finally {
    release()
  }
}

/**
 * @description
 * Delete an existing comment
 *
 * @param {DaemonDatArchive} archive - where to write the comment to.
 * @param {string} pathname - the pathname of the comment.
 * @returns {Promise<void>}
 */
exports.remove = async function (archive, pathname) {
  assert(typeof pathname === 'string', 'Remove() must be provided a valid URL string')
  await archive.pda.unlink(pathname)
  await uwg.crawlSite(archive)
}

// internal methods
// =

/**
 * @param {string} origin
 * @param {string} pathname
 * @returns {string}
 */
function joinPath (origin, pathname) {
  if (origin.endsWith('/') && pathname.startsWith('/')) {
    return origin + pathname.slice(1)
  }
  if (!origin.endsWith('/') && !pathname.startsWith('/')) {
    return origin + '/' + pathname
  }
  return origin + pathname
}

/**
 * @param {Object} row
 * @returns {Promise<Comment>}
 */
async function massageCommentRow (row) {
  if (!row) return null
  var author = await siteDescriptions.getBest({subject: row.crawlSourceUrl})
  if (!author) {
    author = {
      url: row.crawlSourceUrl,
      title: '',
      description: '',
      type: [],
      thumbUrl: `${row.crawlSourceUrl}/thumb`,
      descAuthor: {url: null}
    }
  }
  return {
    pathname: row.pathname,
    author,
    topic: row.topic,
    replyTo: row.replyTo,
    body: row.body,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    visibility: 'public' // TODO visibility
  }
}

/**
 * @param {Object} row
 * @returns {Promise<ThreadedComment>}
 */
async function massageThreadedCommentRow (row) {
  if (!row) return null
  if (row.replies) {
    row.replies = await Promise.all(row.replies.map(massageThreadedCommentRow))
  }
  var author = await siteDescriptions.getBest({subject: row.crawlSourceUrl})
  if (!author) {
    author = {
      url: row.crawlSourceUrl,
      title: '',
      description: '',
      type: [],
      thumbUrl: `${row.crawlSourceUrl}/thumb`,
      descAuthor: {url: null}
    }
  }
  return {
    pathname: row.pathname,
    author,
    topic: row.topic,
    replyTo: row.replyTo,
    body: row.body,
    replies: row.replies || null,
    replyCount: row.replyCount || 0,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    visibility: 'public' // TODO visibility
  }
}
