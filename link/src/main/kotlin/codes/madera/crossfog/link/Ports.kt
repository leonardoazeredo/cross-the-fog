package codes.madera.crossfog.link

/**
 * What an endpoint needs from outside `link/`. Every method is called from whichever thread calls the
 * endpoint (see [Endpoint]), one at a time, and none may call back into that endpoint before it returns.
 */

/**
 * One end of a link's connection. [write] takes all of [bytes] or throws, and must not wait for the
 * peer to read: if both ends sat in a blocking write of an item bigger than the buffers between them,
 * neither could read and no [Endpoint.tick] could run, so the session would hang. A stream that
 * queues the bytes for a writer of its own (the caller drains it beside its reads) is fine, and the
 * confirmation wait then covers the transfer. [close] never throws and may be called twice.
 */
interface ByteStream {
  fun write(bytes: ByteArray)
  fun close()
}

/** A monotonic millisecond clock: timeouts must not jump when the wall clock is set. */
interface Clock {
  fun nowMillis(): Long
}

/** What a store did with an item it was given; a store that cannot keep the item throws, so neither result is a failure. */
enum class SaveResult { SAVED, ALREADY_HELD }

/** Why a receiver will never take an item. The wire names are fixed and nothing else is ever sent as a reason, so no peer text reaches a log. */
enum class RefusalReason(val wire: String) {
  /** The item's content cannot be read (a route's GPX that does not parse). */
  UNREADABLE("unreadable");

  companion object {
    fun of(wire: String): RefusalReason? = entries.firstOrNull { it.wire == wire }
  }
}

/**
 * What a store or sink throws for an item it will never take because of what the item holds. The endpoint
 * answers it with `itemRefused` and keeps the session open. Anything else a store throws is a failure of
 * the store itself (disk, key, I/O): nothing is sent, the session closes and the item is kept and retried.
 */
class ItemRefusedException(val reason: RefusalReason) : Exception(reason.wire)

/** The phone's queue of routes for the watch. Items are read afresh each time, so no endpoint keeps a track in memory between sends. */
interface PhoneRouteStore {
  /** The oldest route not yet delivered, or null. */
  fun nextQueued(): RouteOffer?

  /**
   * Marks the route delivered only if the queued copy still has [revision] (a compare and a mark in
   * one step); false when the route was edited, replaced or removed meanwhile, so a confirmation of
   * an earlier revision marks nothing.
   */
  fun markDelivered(routeId: String, revision: String): Boolean
}

/** Where the phone keeps an activity the watch sent. Storing the same activity again is [SaveResult.ALREADY_HELD] and writes nothing. */
interface ActivitySink {
  fun store(offer: ActivityOffer): SaveResult
}

/** Where the watch keeps a route the phone sent; the same route id and revision again is [SaveResult.ALREADY_HELD], a new revision replaces. */
interface WatchRouteStore {
  fun save(offer: RouteOffer): SaveResult
}

/** The watch's queue of recorded activities for the phone. */
interface ActivityOutbox {
  /** The oldest activity not yet deleted, or null. */
  fun next(): ActivityOffer?

  /** Removes a stored activity; deleting one that is gone is not an error. */
  fun delete(activityId: String)
}

/** Why an endpoint stopped. Nothing here carries peer text. */
enum class CloseReason {
  /** The peer ended the stream between frames. */
  PEER_CLOSED,
  /** The peer ended the stream inside a frame; the partial frame was dropped unread. */
  CUT_MID_FRAME,
  /** A write failed. */
  WRITE_FAILED,
  /** No hello, or no confirmation, within the time allowed. */
  TIMEOUT,
  /** The peer's hello shares no version with ours; our own hello was sent when the link opened. */
  NO_COMMON_VERSION,
  /** Bytes that are not a valid frame or message. */
  BAD_FRAME,
  /** A valid message that does not belong here: wrong direction, out of order, for an id never offered, repeated, or a second hello. */
  UNEXPECTED_MESSAGE,
  /** A store or sink threw; nothing was confirmed and the item stays queued. */
  STORE_FAILED,
  /** An item whose frame would be over the frame cap, so it can never be sent. */
  UNSENDABLE_ITEM,
  /** [Endpoint.close] was called. */
  LOCAL,
  /** The TLS handshake or a TLS record failed (the failure kind is on the session, never peer text). */
  TLS_FAILED,
  /**
   * The peer ended or refused the session before it said anything. A TLS 1.3 client finishes its
   * handshake before the server has checked the client certificate, so a server that does not pin
   * this end shows as an alert or an end of stream after the client's handshake, and that is this reason.
   */
  TLS_REFUSED,
  /** The stream ended without a TLS close_notify, so the end may have been cut by someone on the path. */
  TLS_TRUNCATED,
  /** A pairing session finished as designed (both pins committed). */
  PAIRING_COMPLETE,
  /** A pairing was refused: on the phone, the watch refused the proof; on the watch, this end did (any [PairRejection]). */
  PAIRING_REFUSED,
}

/** Which queue an item belongs to: the phone queues routes for the watch, the watch queues activities for the phone. */
enum class ItemKind { ROUTE, ACTIVITY }

/** An item named by kind and id, so a caller can tell its own queue's item from the peer's. */
data class ItemRef(val kind: ItemKind, val id: String)

/**
 * Everything an endpoint knows when it stops. [failed] is the item a store or sink threw on, or that
 * could not be framed ([CloseReason.STORE_FAILED], [CloseReason.UNSENDABLE_ITEM]); it may be the
 * peer's item (a sink that cannot keep an activity) or this end's own (a route that cannot be marked
 * delivered). [inFlight] is this end's own item that was offered and not yet confirmed when the
 * session ended, for any reason, so a caller can count sessions that ended on the same item.
 */
data class CloseInfo(val reason: CloseReason, val failed: ItemRef?, val inFlight: ItemRef?)

/**
 * The peer refused [item], one of this end's own, for [reason]. [revision] is the revision of the route
 * that was offered (null for an activity), so a caller can set the route aside only if its queued copy
 * still has it.
 */
data class Refusal(val item: ItemRef, val reason: RefusalReason, val revision: String?)

/** What the caller wants to know about the link. */
interface LinkEvents {
  /** Hello exchanged and a version agreed; items flow from here on. Always before [closed], including when the first item sent closes the session. */
  fun ready()

  /**
   * Called once, when the endpoint stops for any reason; the caller opens a new stream and a new
   * endpoint to try again. [itemId] is the route or activity id the endpoint was working on when a
   * store or sink threw ([CloseReason.STORE_FAILED]) or the item could not be put on the wire
   * ([CloseReason.UNSENDABLE_ITEM]); null when no item was in hand (a read of the queue that threw, a
   * timeout, a message out of turn). The same item is first in the queue next session, so a
   * caller that sees the same id fail every time must set it aside, or nothing behind it is ever sent.
   */
  fun closed(reason: CloseReason, itemId: String?)

  /**
   * What an endpoint calls when it stops: [CloseInfo] carries what [closed] does and more. The default
   * forwards to [closed] with the failed item's id, so a caller that wants only that implements
   * [closed]; one that wants the in-flight item implements this.
   */
  fun closedWith(info: CloseInfo) = closed(info.reason, info.failed?.id)

  /**
   * The peer will never take an item this end offered, and the session is still open. The caller sets the
   * item aside (never deletes it) before this returns, so the next item can go out in this session; the
   * endpoint does not offer the same id and revision again in this session either way. The default does nothing.
   */
  fun itemRefused(refusal: Refusal) {}
}

/**
 * How long an endpoint waits. [handshakeTimeoutMs] covers the TLS handshake until it finishes (the hello
 * wait is [helloTimeoutMs]); [pairingWindowMs] is how long a pairing code can be used (the spec gives none).
 */
data class LinkConfig(
  val helloTimeoutMs: Long = 10_000,
  val confirmTimeoutMs: Long = 60_000,
  val handshakeTimeoutMs: Long = 10_000,
  val pairingWindowMs: Long = 5 * 60_000,
) {
  init {
    require(helloTimeoutMs > 0 && confirmTimeoutMs > 0 && handshakeTimeoutMs > 0 && pairingWindowMs > 0) {
      "timeouts must be positive"
    }
  }
}
