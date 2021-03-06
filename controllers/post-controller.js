'use strict'

/**
 * Blog post pages
 *
 * @module controllers/post-controller
 */

const constants = require('../core/constants')
const forms = require('../core/forms')
const models = require('../core/models')
const postService = require('../services/post-service')
const eventService = require('../services/event-service')
const securityService = require('../services/security-service')
const templating = require('./templating')
const cacheProvider = require('../core/cache')

module.exports = {
  handleSaveComment,

  postMiddleware,

  posts,
  article,

  editPost,
  savePost,
  viewPost,
  deletePost,

  saveComment
}

async function postMiddleware (req, res, next) {
  if (req.params.postId && req.params.postId !== 'create') {
    if (forms.isId(req.params.postId)) {
      res.locals.post = await postService.findPostById(req.params.postId)
    }

    if (res.locals.post) {
      res.locals.pageTitle = res.locals.post.get('title')
    } else {
      res.errorPage(404, 'Post not found')
      return
    }
  }

  next()
}

/**
 * Announcements listing
 */
async function posts (req, res) {
  // Fetch posts
  let specialPostType = forms.sanitizeString(req.query['special_post_type']) || null
  let eventId = forms.sanitizeString(req.query['event_id']) || undefined
  let currentPage = forms.isId(req.query.p) ? parseInt(req.query.p) : 1
  let posts = await postService.findPosts({
    specialPostType,
    eventId,
    page: currentPage
  })
  await posts.load(['event', 'entry'])
  let pageCount = await postService.findPosts({
    specialPostType,
    eventId,
    pageCount: true
  })

  // Determine title
  let title = 'Posts'
  if (specialPostType === constants.SPECIAL_POST_TYPE_ANNOUNCEMENT) {
    title = 'Announcements'
  }

  // Determine base URL for pagination
  let paginationBaseUrl = '/posts?'
  if (specialPostType) {
    paginationBaseUrl += '&special_post_type=' + specialPostType
  }
  if (eventId) {
    paginationBaseUrl += '&event_id=' + eventId
  }

  res.render('posts', {
    posts: posts.models,
    title,
    currentPage,
    pageCount,
    paginationBaseUrl
  })
}

/**
 * Articles
 */
async function article (req, res) {
  // postName context variable is used to add a relevant "create article" mod button
  res.locals.postName = forms.sanitizeString(req.params.name)
  res.locals.post = await postService.findPost({
    name: res.locals.postName,
    specialPostType: constants.SPECIAL_POST_TYPE_ARTICLE,
    allowDrafts: true
  })

  if (res.locals.post && (postService.isPast(res.locals.post.get('published_at')) ||
      securityService.canUserRead(res.locals.user, res.locals.post, { allowMods: true }))) {
    res.render('article')
  } else {
    res.errorPage(404)
  }
}

async function viewPost (req, res) {
  // Check permissions
  let post = res.locals.post
  if (postService.isPast(res.locals.post.get('published_at')) ||
      securityService.canUserRead(res.locals.user, post, { allowMods: true })) {
    let context = {
      sortedComments: await postService.findCommentsSortedForDisplay(post)
    }

    // Attach related entry/event
    if (post.get('event_id')) {
      await post.load(['event', 'entry', 'entry.userRoles'])
      if (post.related('event').id) {
        context.relatedEvent = post.related('event')
      }
      if (post.related('entry').id && !post.get('special_post_type')) {
        context.relatedEntry = post.related('entry')
      }
    }

    res.render('post/view-post', context)
  } else {
    res.errorPage(403)
  }
}

async function editPost (req, res) {
  let createMode = !res.locals.post
  if (createMode || securityService.canUserWrite(res.locals.user, res.locals.post, { allowMods: true })) {
    if (createMode) {
      let post = new models.Post()
      if (forms.isId(req.query.eventId)) {
        post.set('event_id', req.query.eventId)
      }
      if (forms.isId(req.query.entryId)) {
        post.set('entry_id', req.query.entryId)
      }
      post.set('special_post_type', forms.sanitizeString(req.query['special_post_type']))
      post.set('title', forms.sanitizeString(req.query.title))

      // Check whether we're trying to create an existing article
      if (post.get('special_post_type') === constants.SPECIAL_POST_TYPE_ARTICLE) {
        post.trigger('titleChanged')
        let existingPost = await postService.findPost({
          name: post.get('name'),
          specialPostType: constants.SPECIAL_POST_TYPE_ARTICLE,
          allowDrafts: true
        })
        if (existingPost) {
          post = existingPost
        }
      }

      res.locals.post = post
    }

    // Fetch related event info
    let post = res.locals.post
    let context = {
      allEvents: (await eventService.findEvents()).models
    }
    if (post.get('event_id')) {
      context.relatedEvent = await eventService.findEventById(post.get('event_id'))
    }
    context.specialPostType = post.get('special_post_type')

    res.render('post/edit-post', context)
  } else {
    res.errorPage(403)
  }
}

async function savePost (req, res) {
  let post = res.locals.post

  // Check permissions
  if ((post && securityService.canUserWrite(res.locals.user, post, { allowMods: true })) ||
      !(post && res.locals.user)) {
    let redirectToView = false
    let {fields} = await req.parseForm()
    let title = forms.sanitizeString(fields.title)
    let errorMessage = null
    if (!title) {
      errorMessage = 'Title is mandatory'
    }

    if (!errorMessage) {
      // Create new post if needed
      if (!post) {
        post = await postService.createPost(res.locals.user)
        let specialPostType = req.query['special_post_type']
        if (specialPostType) {
          validateSpecialPostType(specialPostType, res.locals.user)
          post.set('special_post_type', specialPostType)
        }
      }

      // Fill post from form info
      post.set('title', forms.sanitizeString(fields.title))
      post.set('body', forms.sanitizeMarkdown(fields.body))
      if (forms.isId(fields['event-id'])) {
        post.set('event_id', fields['event-id'])
        if (post.hasChanged('event_id')) {
          let relatedEntry = await eventService.findUserEntryForEvent(
            res.locals.user, post.get('event_id'))
          post.set('entry_id', relatedEntry ? relatedEntry.get('id') : null)
        }
      } else {
        post.set('event_id', null)
        post.set('entry_id', null)
      }

      // Publication & redirection strategy
      redirectToView = true
      if (fields.publish) {
        post.set('published_at', new Date())
      } else if (fields.unpublish) {
        post.set('published_at', null)
        redirectToView = false
      } else if (fields['save-custom']) {
        post.set('published_at', forms.parseDateTime(fields['published-at']))
      }

      // Save
      await post.save()
      cacheProvider.cache.del(res.locals.user.get("name").toLowerCase() + "_latestPostsCollection")
    }

    // Render
    if (redirectToView) {
      res.redirect(templating.buildUrl(post, 'post')) // TODO move buildUrl to routing-service
    } else {
      res.render('post/edit-post', {
        post,
        errorMessage
      })
    }
  } else {
    res.errorPage(403)
  }
}

function validateSpecialPostType (specialPostType, user) {
  if (constants.SPECIAL_POST_TYPES.indexOf(specialPostType) === -1) {
    throw new Error('invalid special post type: ' + specialPostType)
  }
  if (specialPostType === 'announcement' && !securityService.isMod(user)) {
    throw new Error('non-mod ' + user.get('name') + ' attempted to create an announcement')
  }
}

async function deletePost (req, res) {
  await res.locals.post.destroy()
  cacheProvider.cache.del(res.locals.user.get("name").toLowerCase() + "_latestPostsCollection")
  res.redirect('/')
}

/**
 * Save or delete a comment
 */
async function saveComment (req, res) {
  let {fields} = await req.parseForm()
  let redirectUrl = await handleSaveComment(fields, res.locals.user, res.locals.post, templating.buildUrl(res.locals.post, 'post'))
  res.redirect(redirectUrl)
}

/**
 * Handler for handling the comment saving form.
 * Reusable between all controllers of models supporting comments.
 * @param {object} fields The parsed form fields
 * @param {User} user The current user
 * @param {Post|Entry} node The current node model
 * @param {string} baseUrl The view URL for the current node
 * @return {string} A URL to redirect to
 */
async function handleSaveComment (fields, currentUser, currentNode, baseUrl) {
  let redirectUrl = baseUrl

  // Find or create comment
  let comment = null
  let isNewComment = false
  if (fields.id) {
    if (forms.isId(fields.id)) {
      comment = await postService.findCommentById(fields.id)
    } else {
      return redirectUrl
    }
  } else {
    isNewComment = true
    comment = await postService.createComment(currentUser, currentNode)
  }

  if (securityService.canUserWrite(currentUser, comment, { allowMods: true })) {
    if (fields.delete) {
      // Delete comment
      await comment.destroy()
    } else {
      // Update comment
      comment.set('body', forms.sanitizeMarkdown(fields.body))
      await eventService.refreshCommentScore(comment)
      await comment.save()

      // Refresh feedback score on both the giver & receiver entries
      if (comment.get('node_type') === 'entry') {
        let currentEntry = currentNode
        let userEntry = await eventService.findUserEntryForEvent(
          currentUser, currentEntry.get('event_id'))

        // (No need to await, it's okay if the score is a bit late)
        // XXXXXXXXXXXXX
        await eventService.refreshEntryScore(currentEntry)
        if (userEntry) {
          await eventService.refreshEntryScore(userEntry)
        }
      }

      // we need to update the comment feed and unread notifications of users associated with the post/entry
      let node = comment.related("node")
      let userRoles = node.related("userRoles")
      userRoles.forEach(function(userRole) {
        cacheProvider.cache.del(userRole.get("user_name").toLowerCase() + "_toUserCollection")
        cacheProvider.cache.del(userRole.get("user_name").toLowerCase() + "_unreadNotifications")
      })

      // and also any users @mentioned in the comment
      let body = comment.get("body")
      body.split(" ").forEach(function (word) {
        if (word.length > 0 && word[0]=="@") {
          cacheProvider.cache.del(word.slice(1).toLowerCase() + "_toUserCollection")
          cacheProvider.cache.del(word.slice(1).toLowerCase() + "_unreadNotifications")
        }
      })

      redirectUrl += templating.buildUrl(comment, 'comment')
    }
    cacheProvider.cache.del(currentUser.get("name").toLowerCase() + "_byUserCollection")

    // Refresh node comment count
    if (fields.delete || isNewComment) {
      await postService.refreshCommentCount(currentNode)
    }
  }

  return redirectUrl
}
