'use strict'

/**
 * Database storage configuration.
 * Requiring the module returns a [Bookshelf](http://bookshelfjs.org/) instance.
 *
 * @module core/db
 */

const knex = require('knex')
const bookshelf = require('bookshelf')
const config = require('../config')
const log = require('./log')
const models = require('../models/index')

module.exports = initializeDatabase()

// Models sorted by table creation order
const MODEL_FILENAMES_UP = models.modelFilenamesUp()
const MODEL_FILENAMES_DOWN = MODEL_FILENAMES_UP.slice().reverse()
const SETTING_DB_VERSION = 'db_version'

function initializeDatabase () {
  let knexInstance = createKnexInstance()
  return createBookshelfInstance(knexInstance)
}

/*
 * Knex (SQL builder) init
 */
function createKnexInstance () {
  let knexOptions = {
    client: config.DB_TYPE,
    useNullAsDefault: true,
    debug: config.DEBUG_SQL
  }

  if (config.DB_TYPE === 'sqlite3') {
    knexOptions.connection = {
      filename: config.DB_SQLITE_FILENAME
    }
  } else {
    knexOptions.connection = {
      host: config.DB_HOST,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
      charset: 'utf8'
    }
  }
  return knex(knexOptions)
}

/*
 * Bookshelf (ORM) init with custom methods.
 */
function createBookshelfInstance (knexInstance) {
  let db = bookshelf(knexInstance)
  db.plugin('registry')
  db.plugin('pagination')
  db.plugin(require('bookshelf-cascade-delete'))

  /**
   * Finds the current DB version
   * @returns {number} The DB version, or 0 if the DB is empty
   */
  db.findCurrentVersion = async function () {
    const settingService = require('../services/setting-service')
    try {
      return await settingService.find(SETTING_DB_VERSION, 0)
    } catch (e) {
      // Table missing
      // log.warn(e.message)
      return 0
    }
  }

  /**
   * Drops all tables from the database.
   * @returns {void}
   */
  db.dropTables = async function () {
    for (let modelFilename of MODEL_FILENAMES_DOWN) {
      log.info('Drop model: ' + modelFilename + '...')
      let model = require('../models/' + modelFilename)
      await model.down()
    }
  }

  /**
   * Upgrades the whole database to the latest version.
   * Creates the tables if needed.
   * @param {boolean} silent Whether to log DB upgrades
   * @returns {void}
   */
  db.upgradeTables = async function (silent) {
    let currentVersion = await db.findCurrentVersion()
    let upgradeRequired = currentVersion < models.version

    while (currentVersion < models.version) {
      let nextVersion = currentVersion + 1
      for (let modelFilename of MODEL_FILENAMES_UP) {
        let model = require('../models/' + modelFilename)
        if (!silent) {
          log.info('Upgrade model: ' + modelFilename + ' to version ' + nextVersion + '...')
        }
        await model.up(nextVersion)
      }
      currentVersion = nextVersion
    }

    if (upgradeRequired) {
      const settingService = require('../services/setting-service')
      await settingService.save(SETTING_DB_VERSION, models.version)
    }
  }

  /**
   * Inserts sample data in the database.
   * @returns {void}
   */
  db.insertSamples = async function () {
    log.info('Inserting samples...')

    let userService = require('../services/user-service')
    let User = require('../models/user-model')
    let Event = require('../models/event-model')
    let Entry = require('../models/entry-model')

    let adminUser = new User({
      name: 'administrator',
      title: 'Administrator',
      is_admin: true
    })
    userService.setPassword(adminUser, 'administrator')
    await adminUser.save()

    let weJam1 = new Event({
      title: '1st WeJam',
      slug: '1st-wejam',
      status: 'closed',
      display_dates: 'Novembary 17 - 20, 2016',
      display_theme: 'Make a website'
    })
    await weJam1.save()

    let weJam1Entries = weJam1.related('entries')
    await weJam1Entries.create({ title: 'Old Game' })

    let weJam2 = new Event({
      title: '2nd WeJam',
      slug: '2nd-wejam',
      status: 'open',
      display_dates: 'Januember 29 - 31, 2017',
      display_theme: 'You are not alone'
    })
    await weJam2.save()

    await weJam2.entries().create({ title: 'Game A' })
    await weJam2.entries().create({ title: 'Game B' })
  }

  return db
}
