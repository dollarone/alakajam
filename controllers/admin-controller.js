'use strict'

/**
 * Global pages
 *
 * @module controllers/main-controller
 */

const config = require('../config')
const db = require('../core/db')
const constants = require('../core/constants')
const forms = require('../core/forms')
const postService = require('../services/post-service')
const securityService = require('../services/security-service')
const eventService = require('../services/event-service')
const userService = require('../services/user-service')
const settingService = require('../services/setting-service')

module.exports = {
  adminMiddleware,

  adminHome,
  adminArticles,

  adminEvents,
  adminSettings,
  adminUsers,
  adminStatus,
  adminDev
}

async function adminMiddleware (req, res, next) {
  if (!config.DEBUG_ADMIN && !securityService.isMod(res.locals.user)) {
    res.errorPage(403)
  } else {
    next()
  }
}

/**
 * Edit home announcements
 */
async function adminHome (req, res) {
  let allPostsCollection = await postService.findPosts({
    specialPostType: constants.SPECIAL_POST_TYPE_ANNOUNCEMENT,
    allowDrafts: true
  })
  let draftPosts = allPostsCollection.where({'published_at': null})
  res.render('admin/admin-home', {
    draftPosts,
    publishedPosts: allPostsCollection.difference(draftPosts)
  })
}

/**
 * Edit articles
 */
async function adminArticles (req, res) {
  let allPostsCollection = await postService.findPosts({
    specialPostType: constants.SPECIAL_POST_TYPE_ARTICLE,
    allowDrafts: true
  })

  let missingArticles = []
  for (let articleName of constants.REQUIRED_ARTICLES) {
    if (!allPostsCollection.find((post) => post.get('name') === articleName)) {
      missingArticles.push(articleName)
    }
  }

  let draftPosts = allPostsCollection.where({'published_at': null})
  res.render('admin/admin-articles', {
    draftPosts,
    publishedPosts: allPostsCollection.difference(draftPosts),
    missingArticles
  })
}

/**
 * Admin only: events management
 */
async function adminEvents (req, res) {
  let events = await eventService.findEvents()
  res.render('admin/admin-events', {
    events: events.models
  })
}

/**
 * Admin only: settings management
 */
async function adminSettings (req, res) {
  // Save changed setting
  if (req.method === 'POST') {
    let {fields} = await req.parseForm()
    if (constants.EDITABLE_SETTINGS.indexOf(fields.key) !== -1) {
      await settingService.save(fields.key, forms.sanitizeString(fields.value))
    } else {
      req.errorPage(403, 'Tried to edit a non-editable setting')
      return
    }
  }

  // Gather editable settings
  let settings = []
  for (let key of constants.EDITABLE_SETTINGS) {
    settings.push({
      key,
      value: await settingService.find(key)
    })
  }

  // Fetch setting to edit
  let editSetting
  if (req.query.edit && forms.isSlug(req.query.edit)) {
    editSetting = {
      key: req.query.edit,
      value: await settingService.find(req.query.edit)
    }
  }

  res.render('admin/admin-settings', {
    settings,
    editSetting
  })
}

/**
 * Admin only: users management
 */
async function adminUsers (req, res) {
  let users = await userService.findAll()
  res.render('admin/admin-users', {
    users: users.models
  })
}

/**
 * Admin only: server status
 */
async function adminStatus (req, res) {
  let pictureResizeEnabled = false
  try {
    require('sharp')
    pictureResizeEnabled = true
  } catch (e) {
    // Nothing
  }

  res.render('admin/admin-status', {
    devMode: !!res.app.locals.devMode,
    pictureResizeEnabled
  })
}

/**
 * Admin only: developer tools
 */
async function adminDev (req, res) {
  if (res.app.locals.devMode) {
    let infoMessage = ''
    let errorMessage = ''
    if (req.method === 'POST') {
      let {fields} = await req.parseForm()
      if (fields['db-reset']) {
        await db.emptyDatabase()
        let newVersion = await db.initDatabase(config.DEBUG_INSERT_SAMPLES)
        infoMessage = 'DB reset done (current version : ' + newVersion + ').'
      }
    }
    res.render('admin/admin-dev', {
      infoMessage,
      errorMessage
    })
  } else {
    res.errorPage(403, 'Page only available in development mode')
  }
}
