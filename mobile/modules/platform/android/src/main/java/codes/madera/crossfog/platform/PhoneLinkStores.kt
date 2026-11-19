package codes.madera.crossfog.platform

import codes.madera.crossfog.link.ActivityOffer
import codes.madera.crossfog.link.ActivitySink
import codes.madera.crossfog.link.CloseInfo
import codes.madera.crossfog.link.CloseReason
import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import codes.madera.crossfog.link.LedgerAction
import codes.madera.crossfog.link.LinkEvents
import codes.madera.crossfog.link.Messages
import codes.madera.crossfog.link.PhoneRouteStore
import codes.madera.crossfog.link.RouteOffer
import codes.madera.crossfog.link.SaveResult

/**
 * The phone's routes for the watch, kept in the outbox [store]. Compound steps hold the store's own
 * monitor, so a route the page queues again between an offer and its confirmation is seen by the
 * compare in [markDelivered] and not lost.
 */
internal class OutboxRoutes(
  private val store: StagingStore,
  private val ledger: ItemLedger,
  private val onDelivered: (routeId: String, revision: String) -> Unit,
) : PhoneRouteStore {
  /** Refuses a route that does not parse, would not fit a frame once sent, or is filed under another id. */
  fun queue(id: String, bytes: ByteArray) {
    val offer = Frames.parseRouteOffer(bytes)
    if (offer.routeId != id) throw FrameException("route id does not match")
    store.stage(id, bytes)
  }

  override fun nextQueued(): RouteOffer? {
    val remaining = store.listOldestFirst().toMutableList()
    while (remaining.isNotEmpty()) {
      val id = ledger.prefer(remaining) ?: return null
      remaining.remove(id)
      // An item that can never be opened must not hold up the routes behind it; the page removes
      // such files through discardUnreadableRoutes.
      val offer = try {
        store.read(id)?.let { Frames.parseRouteOffer(it) }
      } catch (e: UnreadableItemException) {
        null
      } catch (e: FrameException) {
        null
      }
      if (offer != null && offer.routeId == id) return offer
    }
    return null
  }

  override fun markDelivered(routeId: String, revision: String): Boolean {
    synchronized(store) {
      val current = try {
        store.read(routeId)?.let { Frames.parseRouteOffer(it) }
      } catch (e: FrameException) {
        null
      } ?: return false
      if (current.routeId != routeId || current.revision != revision) return false
      store.release(routeId)
      ledger.confirmed(routeId)
    }
    onDelivered(routeId, revision)
    return true
  }

  /** Takes a route out of the queue without deleting it, and forgets its counts. */
  fun setAside(id: String) {
    synchronized(store) {
      store.setAside(id)
      ledger.forget(id)
    }
  }
}

/**
 * Where an activity the watch sent is kept until the page hands it off. It answers [SaveResult.ALREADY_HELD]
 * only for an activity still staged: one the page already released is staged again, and the page's own
 * store, which ignores an id it holds, keeps it from becoming a second walk.
 */
internal class StagingSink(
  private val store: StagingStore,
  private val onStaged: (activityId: String) -> Unit,
) : ActivitySink {
  override fun store(offer: ActivityOffer): SaveResult {
    synchronized(store) {
      if (offer.activityId in store.list()) return SaveResult.ALREADY_HELD
      store.stage(offer.activityId, Messages.encode(offer))
    }
    onStaged(offer.activityId)
    return SaveResult.SAVED
  }
}

/**
 * Applies what the ledger decides when a session ends: a route that failed locally every time is set
 * aside and announced, so the page can tell the user to send it again. A demotion changes only the
 * order [OutboxRoutes] offers its routes in, so nothing is done for one here.
 */
internal class LedgerEvents(
  private val ledger: ItemLedger,
  private val routes: OutboxRoutes,
  private val onRouteSetAside: (routeId: String) -> Unit,
) : LinkEvents {
  override fun ready() = Unit

  override fun closed(reason: CloseReason, itemId: String?) = Unit

  override fun closedWith(info: CloseInfo) {
    for (action in ledger.onClosed(info)) {
      if (action is LedgerAction.SetAside && action.item.kind == ItemKind.ROUTE) {
        routes.setAside(action.item.id)
        onRouteSetAside(action.item.id)
      }
    }
  }
}
