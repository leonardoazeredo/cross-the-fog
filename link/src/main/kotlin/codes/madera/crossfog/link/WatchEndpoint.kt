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

  // The activity the phone refused in this session: not offered again, so an app that left it queued cannot make the session loop on it.
  private var refusedActivityId: String? = null

  override fun inFlight(): ItemRef? = offeredActivityId?.let { ItemRef(ItemKind.ACTIVITY, it) }

  override fun pump() {
    if (offeredActivityId != null) return
    val activity = try {
      outbox.next()
    } catch (e: Exception) {
      return close(CloseReason.STORE_FAILED)
    } ?: return
    if (activity.activityId == refusedActivityId) return
    // In flight from before the write: a write that fails halfway still leaves the peer holding part of this item.
    offeredActivityId = activity.activityId
    if (send(activity)) {
      armConfirm()
    }
  }

  override fun onMessage(message: Message) {
    when (message) {
      is RouteOffer -> onRoute(message)
      is ActivityStored -> onActivityStored(message)
      is ItemRefused -> onActivityRefused(message)
      // The phone never sends the watch a route confirmation or an activity offer.
      else -> close(CloseReason.UNEXPECTED_MESSAGE)
    }
  }

  private fun onActivityRefused(refusal: ItemRefused) {
    val id = offeredActivityId
    if (id == null || refusal.kind != ItemKind.ACTIVITY || id != refusal.id) return close(CloseReason.UNEXPECTED_MESSAGE)
    refusedActivityId = id
    offeredActivityId = null
    disarmConfirm()
    // A caller that sets the activity aside inside this call lets pump find the next one; one that leaves it in
    // the outbox has pump send nothing while it is first there (refusedActivityId).
    report(Refusal(ItemRef(ItemKind.ACTIVITY, id), refusal.reason, null))
    if (!isClosed) pump()
  }

  private fun onRoute(offer: RouteOffer) {
    try {
      routes.save(offer)
    } catch (e: ItemRefusedException) {
      send(ItemRefused(ItemKind.ROUTE, offer.routeId, e.reason))
      return
    } catch (e: Exception) {
      return close(CloseReason.STORE_FAILED, ItemRef(ItemKind.ROUTE, offer.routeId))
    }
    send(RouteSaved(offer.routeId, offer.revision))
  }

  private fun onActivityStored(stored: ActivityStored) {
    if (offeredActivityId != stored.activityId) return close(CloseReason.UNEXPECTED_MESSAGE)
    try {
      outbox.delete(stored.activityId)
    } catch (e: Exception) {
      return close(CloseReason.STORE_FAILED, ItemRef(ItemKind.ACTIVITY, stored.activityId))
    }
    offeredActivityId = null
    disarmConfirm()
    pump()
  }
}
