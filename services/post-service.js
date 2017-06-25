'use strict'

/**
 * Blog post service.
 *
 * @module services/post-service
 */

const models = require('../core/models')
const constants = require('../core/constants')
const securityService = require('../services/security-service')

module.exports = {
  isPast,
  wasEdited,

  findPosts,
  findPostById,
  findPost,
  findLatestAnnouncement,
  findCommentById,
  findCommentsSortedForDisplay,
  findCommentsByUser,
  findCommentsToUser,

  createPost,
  refreshCommentCount,
  createComment
}

/**
 * Indicates if a date is already past
 * @param  {number}  time
 * @return {Boolean}
 */
function isPast (time) {
  return time && (new Date().getTime() - time) > 0
}

/**
 * Tells whether a model has been edited > 1 hour after its creation
 * @param  {Model} model Any model with timestamps
 * @return {bool}
 */
function wasEdited (model) {
  return model.get('updated_at') - model.get('created_at') > 3600 * 1000
}

/**
 * Finds all posts from a feed (specified through options)
 * @param  {object} options among "specialPostType allowDrafts eventId entryId userId"
 * @return {array(Post)}
 */
async function findPosts (options = {}) {
  let postCollection = await models.Post
  postCollection = postCollection.query(function (qb) {
    qb = qb.distinct()
    if (options.specialPostType !== undefined) qb = qb.where('special_post_type', options.specialPostType)
    if (options.eventId) qb = qb.where('event_id', options.eventId)
    if (options.entryId) qb = qb.where('entry_id', options.entryId)
    if (options.userId) {
      qb = qb.innerJoin('user_role', 'post.id', 'user_role.node_id')
          .where({
            'user_role.user_id': options.userId,
            'user_role.node_type': 'post'
          })
          .whereIn('permission', securityService.getPermissionsEqualOrAbove(constants.PERMISSION_WRITE))
    }
    if (!options.allowDrafts) qb = qb.where('published_at', '<=', new Date())
    return qb
  })
  postCollection.orderBy('published_at', 'DESC')

  if (options.pageCount) {
    return postCollection.count().then(function (count) {
      return Math.max(1, count / 10)
    })
  } else {
    return postCollection.fetchPage({
      pageSize: options.count ? undefined : 10,
      page: options.page,
      withRelated: ['author', 'userRoles']
    })
  }
}

async function findPostById (postId) {
  return models.Post.where('id', postId)
    .fetch({withRelated: ['author', 'userRoles']})
}

/**
 * Finds one post
 * @param  {object} options among "id name userId eventId specialPostType allowDrafts"
 * @return {Post}
 */
async function findPost (options = {}) {
  let query = models.Post
  if (options.id) query = query.where('id', options.id)
  if (options.name) query = query.where('name', options.name)
  if (options.eventId) query = query.where('event_id', options.eventId)
  if (options.userId) query = query.where('author_user_id', options.userId)
  if (options.specialPostType !== undefined) query = query.where('special_post_type', options.specialPostType)
  if (!options.allowDrafts) query = query.where('published_at', '<=', new Date())
  return query.fetch({withRelated: ['author', 'userRoles']})
}

/**
 * Finds the latest announcement
 * @param  {Object} options amoung "eventId"
 * @return {Post}
 */
async function findLatestAnnouncement (options = {}) {
  let query = models.Post.where('special_post_type', constants.SPECIAL_POST_TYPE_ANNOUNCEMENT)
  if (options.eventId) {
    query = query.where('event_id', options.eventId)
  }
  return query.orderBy('published_at', 'DESC')
    .fetch({withRelated: ['author', 'userRoles']})
}

async function findCommentById (commentId) {
  return models.Comment.where('id', commentId)
    .fetch({withRelated: ['user']})
}

/**
 * Fetches the comments of the given node, and sorts them by creation date.
 * @param  {Post|Entry} node
 * @return {array(Comment)}
 */
async function findCommentsSortedForDisplay (node) {
  // TODO Actual SQL query
  await node.load(['comments', 'comments.user'])
  return node.related('comments').sortBy(comment => comment.get('created_at'))
}

/**
 * Fetches all comments written by an user
 * @param  {User} user
 * @return {Collection(Comment)}
 */
async function findCommentsByUser (user) {
  return models.Comment.where('user_id', user.id)
    .orderBy('created_at', 'DESC')
    .fetchAll({withRelated: ['user', 'node']})
}

/**
 * Fetches all comments interesting for an user.
 * This includes both "@"-mentions and all comments to the user posts & entries.
 * @param  {User} user
 * @return {Collection(Comment)}
 */
async function findCommentsToUser (user) {
  return models.Comment.query(function (qb) {
    qb.leftJoin('user_role', function () {
      this.on('comment.node_id', '=', 'user_role.node_id')
        .andOn('comment.node_type', '=', 'user_role.node_type')
    })
      .where('user_role.user_id', user.id)
      .andWhere('comment.user_id', '<>', user.id)
      .orWhere('body', 'like', '%@' + user.get('name') + '%') // TODO Use special mention/notification table filled on write
  })
    .orderBy('created_at', 'DESC')
    .fetchAll({withRelated: ['user', 'node']})
}

/**
 * Creates and persists a new post, initializing the owner UserRole.
 * @param  {User} user
 * @return {Post}
 */
async function createPost (user) {
  // TODO Better use of Bookshelf API
  let post = new models.Post()
  post.set('author_user_id', user.get('id'))
  await post.save() // otherwise the user role won't have a node_id
  await post.userRoles().create({
    user_id: user.get('id'),
    user_name: user.get('name'),
    user_title: user.get('title'),
    permission: constants.PERMISSION_MANAGE
  })
  return post
}

/**
 * Creates a new comment.
 * @param  {User} user
 * @param  {Post|Entry} node
 * @param  {string} (optional) comment body
 * @return {Comment}
 */
async function createComment (user, node, body) {
  let comment = await node.comments().create({
    user_id: user.get('id'),
    body: body
  })
  return comment
}

/**
 * Updates the comment count on the given node and saves it.
 * @param {Post|Entry} node
 */
async function refreshCommentCount (node) {
  await node.load('comments')
  let commentCount = node.related('comments').size()
  node.set('comment_count', commentCount)
  await node.save()
}
