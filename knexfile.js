/**
 * Knex DB migration configuration.
 *
 * @module knexfile
 */

let config = require('./config')
let path = require('path')

module.exports = {

  directory: path.join(path.relative(process.cwd(), __dirname), 'migrations'),

  development: {
    client: config.DB_TYPE,
    connection: {
      filename: config.DB_SQLITE_FILENAME,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  }

}
