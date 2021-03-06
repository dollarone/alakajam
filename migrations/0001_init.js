/**
 * DB Initialization
 */

exports.up = async function (knex, Promise) {
  try {
    await knex.schema.createTableIfNotExists('setting', function (table) {
      table.string('key').primary()
      table.string('value')
      table.timestamps()
    })

    // User

    await knex.schema.createTableIfNotExists('user', function (table) {
      table.increments('id').primary()
      table.string('name').unique()
      table.string('title')
      table.string('email')
      table.string('avatar')
      table.string('is_mod')
      table.string('is_admin')
      table.string('password')
      table.string('password_salt')
      table.timestamps()
    })

    await knex.schema.createTableIfNotExists('user_details', function (table) {
      table.increments('id').primary()
      table.integer('user_id').references('user.id').unique()
      table.string('body', 10000)
      table.string('social_links', 1000)
    })

    await knex.schema.createTableIfNotExists('user_role', function (table) {
      table.increments('id').primary()
      table.integer('user_id').references('user.id')
      table.string('user_name')
      table.string('user_title')
      table.integer('node_id')
      table.string('node_type')
      table.string('permission') // allowed: owner
      table.timestamps()

      table.index(['node_id', 'node_type'])
    })

    // Event

    await knex.schema.createTableIfNotExists('event', function (table) {
      table.increments('id').primary()
      table.string('name').unique()
      table.string('title')
      table.string('display_dates')
      table.string('display_theme')
      table.string('status').index()
      table.string('status_theme')
      table.string('status_entry')
      table.string('status_results')
      table.string('countdown_config') // JSON Object : {phrase, date}
      table.dateTime('published_at').index()
      table.timestamps()
    })

    await knex.schema.createTableIfNotExists('entry', function (table) {
      table.increments('id').primary()
      table.integer('event_id').references('event.id')
      table.string('event_name')
      table.string('name')
      table.string('title')
      table.string('description', 2000)
      table.string('links') // JSON Array : [{url, title}]
      table.string('pictures') // JSON Array : [path]
      table.string('category') // "solo"/"team"
      table.dateTime('published_at')
      table.integer('comment_count')
      table.timestamps()
    })

    await knex.schema.createTableIfNotExists('entry_details', function (table) {
      table.increments('id').primary()
      table.integer('entry_id').references('entry.id').unique()
      table.string('body', 10000)
    })

    // Posts

    await knex.schema.createTableIfNotExists('post', function (table) {
      table.increments('id').primary()
      table.integer('author_user_id').references('user.id')
      table.string('name')
      table.string('title')
      table.integer('entry_id').references('entry.id')
      table.integer('event_id').references('event.id')
      table.string('body', 10000)
      table.dateTime('published_at').index()
      table.string('special_post_type')
      table.integer('comment_count')
      table.timestamps()
    })

    await knex.schema.createTableIfNotExists('comment', function (table) {
      table.increments('id').primary()
      table.integer('node_id')
      table.string('node_type')
      table.integer('user_id').references('user.id')
      table.integer('parent_id').references('comment.id')
      table.string('body', 10000)
      table.timestamps()

      table.index('created_at')
      table.index(['node_id', 'node_type'])
    })

    Promise.resolve()
  } catch (e) {
    Promise.reject(e)
  }
}

exports.down = async function (knex, Promise) {
  try {
    for (let table of ['comment', 'post',
      'entry_details', 'entry', 'event',
      'user_role', 'user_details', 'user',
      'setting']) {
      await knex.schema.dropTableIfExists(table)
    }
    Promise.resolve()
  } catch (e) {
    Promise.reject(e)
  }
}
