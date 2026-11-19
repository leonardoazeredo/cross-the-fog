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
  /** A pairing was refused: the watch said no, or this end said no to a second claim on the code. */
  PAIRING_REFUSED,
}

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
}

/**
 * How long an endpoint waits. [handshakeTimeoutMs] covers the TLS handshake until the peer's first
 * message; [pairingWindowMs] is how long a pairing code can be used (the spec gives none).
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
