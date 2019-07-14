const EventEmitter = require('events')
const db = require('./profile-data-db')
const knex = require('../lib/knex')
const lock = require('../lib/lock')

// typedefs
// =

/**
 * @typedef {Object} DatDnsRecord
 * @prop {string} name
 * @prop {string} key
 * @prop {boolean} isCurrent
 * @prop {number} lastConfirmedAt
 * @prop {number} firstConfirmedAt
 */

// globals
// =

const events = new EventEmitter()

// exported api
// =

exports.on = events.on.bind(events)
exports.once = events.once.bind(events)
exports.removeListener = events.removeListener.bind(events)

/**
 * @param {string} name
 * @returns {Promise<DatDnsRecord>}
 */
exports.getCurrentByName = async function (name) {
  return massageDNSRecord(await db.get(knex('dat_dns').where({name, isCurrent: 1})))
}

/**
 * @param {string} key
 * @returns {Promise<DatDnsRecord>}
 */
exports.getCurrentByKey = async function (key) {
  return massageDNSRecord(await db.get(knex('dat_dns').where({key, isCurrent: 1}).orderBy('name')))
}

/**
 * @param {Object} opts
 * @param {string} opts.key
 * @param {string} opts.name
 * @returns {Promise<void>}
 */
exports.update = async function ({key, name}) {
  var release = await lock('dat-dns-update:' + name)
  try {
    let curr = await db.get(knex('dat_dns').where({name, key}))
    if (!curr) {
      await db.run(knex('dat_dns').update({isCurrent: 0}).where({name}))
      await db.run(knex('dat_dns').insert({
        name,
        key,
        isCurrent: 1,
        lastConfirmedAt: Date.now(),
        firstConfirmedAt: Date.now()
      }))
    } else {
      await db.run(knex('dat_dns').update({lastConfirmedAt: Date.now()}).where({name, key}))
    }
    events.emit('update', {key, name})
  } finally {
    release()
  }
}

// internal methods
// =

function massageDNSRecord (record) {
  if (!record) return null
  return {
    name: record.name,
    key: record.key,
    isCurrent: Boolean(record.isCurrent),
    lastConfirmedAt: record.lastConfirmedAt,
    firstConfirmedAt: record.firstConfirmedAt
  }
}