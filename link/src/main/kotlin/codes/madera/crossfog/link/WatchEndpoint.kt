package codes.madera.crossfog.link

/**
 * The watch's end: takes in the routes the phone sends and sends the activities it recorded.
 *
 * `routeSaved` carries the revision of the route as received and goes out only after
 * [WatchRouteStore.save] reports it kept. An activity leaves the outbox only on `activityStored` for
 * the id outstanding, so a link that drops before the confirmation leaves it queued, and the phone
 * answers the resend without storing it twice.
 */
class WatchEndpoint(
  stream: ByteStream,
  clock: Clock,
  private val routes: WatchRouteStore,
  private val outbox: ActivityOutbox,
  events: LinkEvents,
  config: LinkConfig = LinkConfig(),
) : Endpoint(stream, clock, events, config) {
  // Only the id is kept; the activity is read from the outbox again for any resend.
  private var offeredActivityId: String? = null

  override fun pump() {
    if (offeredActivityId != null) return
    val activity = try {
      outbox.next()
    } catch (e: Exception) {
      return close(CloseReason.STORE_FAILED)
    } ?: return
    val id = activity.activityId
    if (send(activity)) {
      offeredActivityId = id
      armConfirm()
    }
  }

  override fun onMessage(message: Message) {
    when (message) {
      is RouteOffer -> onRoute(message)
      is ActivityStored -> onActivityStored(message)
      // The phone never sends the watch a route confirmation or an activity offer.
      else -> close(CloseReason.UNEXPECTED_MESSAGE)
    }
  }

  private fun onRoute(offer: RouteOffer) {
    try {
      routes.save(offer)
    } catch (e: Exception) {
      return close(CloseReason.STORE_FAILED)
    }
    send(RouteSaved(offer.routeId, offer.revision))
  }

  private fun onActivityStored(stored: ActivityStored) {
    if (offeredActivityId != stored.activityId) return close(CloseReason.UNEXPECTED_MESSAGE)
    try {
      outbox.delete(stored.activityId)
    } catch (e: Exception) {
      return close(CloseReason.STORE_FAILED)
    }
    offeredActivityId = null
    disarmConfirm()
    pump()
  }
}
