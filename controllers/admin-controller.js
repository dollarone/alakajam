'use strict'

/**
 * Global pages
 *
 * @module controllers/main-controller
 */

const db = require('../core/db')
const config = require('../config')
const postService = require('../services/post-service')
const Post = require('../models/post-model')

module.exports = {

  initRoutes: function (app) {
    app.use('/admin*', adminSecurity)
    app.get('/admin', adminHome)
    app.all('/admin/dev', adminDev)
  }

}

async function adminSecurity (req, res, next) {
  if ((!res.locals.user || !res.locals.user.get('is_admin')) && !config.DEBUG_ADMIN) {
    res.render('403')
  } else {
    next()
  }
}

/**
 * Edit home announcement
 */
async function adminHome (req, res) {
  res.render('admin/admin-home', {
    posts: await postService.findAnnouncements()
  })
}

/**
 * Admin developer tools
 * TODO Make it only available in dev environments
 */
async function adminDev (req, res) {
  let infoMessage = '', errorMessage = ''
  if (req.method === 'POST') {
    let {fields} = await req.parseForm()
    if (fields['db-reset']) {
      await db.dropTables()
      await db.upgradeTables()
      await db.insertSamples()
      let version = await db.findCurrentVersion()
      infoMessage = 'DB reset done (current version : ' + version + ').'
    }
  }
  res.render('admin/admin-dev', {
    infoMessage,
    errorMessage
  })
}
