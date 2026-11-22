package codes.madera.crossfog.link

/**
 * The phone's end: sends queued routes to the watch and takes in the activities the watch records.
 *
 * A route is delivered only when the watch answers `routeSaved` for the id and revision that is
 * outstanding, and [PhoneRouteStore.markDelivered] marks it only if the queued copy still has that
 * revision. An activity is confirmed (`activityStored`) only after [ActivitySink.store] reports it
 * kept, so a sink that throws sends no confirmation and the watch keeps the activity.
 */
class PhoneEndpoint(
  stream: ByteStream,
  clock: Clock,
  private val routes: PhoneRouteStore,
  private val sink: ActivitySink,
  events: LinkEvents,
  config: LinkConfig = LinkConfig(),
) : Endpoint(stream, clock, events, config) {
  private data class Offered(val routeId: String, val revision: String)

  // The route the watch refused in this session: not offered again unless its revision changed, so an app that left it queued cannot make the session loop on it.
  private var refused: Offered? = null

  // Only the key is kept; the route is read from the store again for any resend, so no track stays in memory.
  private var offered: Offered? = null

  override fun inFlight(): ItemRef? = offered?.let { ItemRef(ItemKind.ROUTE, it.routeId) }

  override fun pump() {
    if (offered != null) return
    val route = try {
      routes.nextQueued()
    } catch (e: Exception) {
      return close(CloseReason.STORE_FAILED)
    } ?: return
    if (route.routeId == refused?.routeId && route.revision == refused?.revision) return
    // In flight from before the write: a write that fails halfway still leaves the peer holding part of this item.
    offered = Offered(route.routeId, route.revision)
    if (send(route)) {
      armConfirm()
    }
  }

  override fun onMessage(message: Message) {
    when (message) {
      is RouteSaved -> onRouteSaved(message)
      is ItemRefused -> onRouteRefused(message)
      is ActivityOffer -> onActivity(message)
      // The watch never sends the phone a route offer or an activity confirmation.
      else -> close(CloseReason.UNEXPECTED_MESSAGE)
    }
  }

  private fun onRouteSaved(saved: RouteSaved) {
    val key = offered
    if (key == null || key.routeId != saved.routeId || key.revision != saved.revision) {
      return close(CloseReason.UNEXPECTED_MESSAGE)
    }
    try {
      routes.markDelivered(saved.routeId, saved.revision)
    } catch (e: Exception) {
      return close(CloseReason.STORE_FAILED, ItemRef(ItemKind.ROUTE, saved.routeId))
    }
    offered = null
    disarmConfirm()
    pump()
  }

  private fun onRouteRefused(refusal: ItemRefused) {
    val key = offered
    if (key == null || refusal.kind != ItemKind.ROUTE || key.routeId != refusal.id) return close(CloseReason.UNEXPECTED_MESSAGE)
    refused = key
    offered = null
    disarmConfirm()
    // A caller that sets the route aside inside this call lets pump find the next one; one that leaves it queued
    // has pump send nothing while that route is first in the queue.
    report(Refusal(ItemRef(ItemKind.ROUTE, key.routeId), refusal.reason, key.revision))
    if (!isClosed) pump()
  }

  private fun onActivity(offer: ActivityOffer) {
    try {
      sink.store(offer)
    } catch (e: ItemRefusedException) {
      send(ItemRefused(ItemKind.ACTIVITY, offer.activityId, e.reason))
      return
    } catch (e: Exception) {
      return close(CloseReason.STORE_FAILED, ItemRef(ItemKind.ACTIVITY, offer.activityId))
    }
    send(ActivityStored(offer.activityId))
  }
}
