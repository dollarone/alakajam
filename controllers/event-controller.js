'use strict'

/**
 * Event pages
 *
 * @module controllers/event-controller
 */

const eventService = require('../services/event-service')

module.exports = {

  initRoutes: function (app) {
    app.use('/:eventSlug([^/]*-[^/]*)', eventMiddleware)
    app.use('/:eventSlug([^/]*-[^/]*)/*', eventMiddleware)

    app.get('/:eventSlug([^/]*-[^/]*)', viewEvent)
  }

}

/**
 * Fetches the event & optionally the user's entry
 */
async function eventMiddleware (req, res, next) {
  let event = await eventService.findEventBySlug(req.params.eventSlug)
  res.locals.event = event
  if (res.locals.user) {
    res.locals.userEntry = await eventService.findUserEntryForEvent(res.locals.user, event.get('id'))
  }
  next()
}

/**
 * Browse event
 */
async function viewEvent (req, res) {
  if (res.locals.event) {
    res.render('event/view-event-games')
  } else {
    res.errorPage(404, 'Event not found')
  }
}
