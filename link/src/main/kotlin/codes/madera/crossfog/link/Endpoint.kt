package codes.madera.crossfog.link

/**
 * One end of a link, driven by its caller: the caller owns the stream and the threads and calls
 * [open], [onBytes], [onClosed], [tick] and [wake] one at a time (from one thread or under one
 * lock), so nothing in `link/` starts a thread or sleeps. [onBytes] takes whatever the stream read,
 * in pieces of any size; [tick] is called when [nextDeadline] has passed on the injected clock;
 * [wake] says an item was queued while the link was idle. This is what both apps can do: the phone
 * runs it on its socket's executor, the watch from its own loop, and a TLS engine (which wraps and
 * unwraps without threads) feeds it the same way.
 *
 * A session is one stream. Whatever goes wrong (a refusal of an item is not one), the endpoint closes the
 * stream, reports one [CloseReason] and does nothing more; the caller makes a new stream and a new endpoint, which
 * sends the items still queued again. What was in flight lives only in the endpoint, so a lost
 * session needs no recovery: the stores say what is queued, and a peer that already stored an item
 * answers a resend with the confirmation and no second write.
 *
 * Nothing is sent before the peer's hello has arrived and agreed a version. One item per
 * direction is outstanding at a time (stop and wait), which bounds what is in memory to one item and
 * makes "out of order" a question with one answer.
 */
abstract class Endpoint(
  private val stream: ByteStream,
  private val clock: Clock,
  private val events: LinkEvents,
  private val config: LinkConfig,
  maxFrameBytes: Int = Framing.MAX_FRAME_BYTES,
) {
  private enum class Phase { NEW, AWAITING_HELLO, READY, CLOSED }

  private var phase = Phase.NEW
  private val decoder = Framing.Decoder(maxFrameBytes)
  private var helloDeadline = 0L
  private var confirmDeadline: Long? = null

  /** Writes our hello. Both ends do this on connecting; nothing else is written until the peer's hello has agreed a version. */
  fun open() {
    check(phase == Phase.NEW) { "already opened" }
    phase = Phase.AWAITING_HELLO
    helloDeadline = clock.nowMillis() + config.helloTimeoutMs
    send(Hello(Protocol.SUPPORTED))
  }

  fun onBytes(bytes: ByteArray, offset: Int, length: Int) {
    if (phase == Phase.CLOSED) return
    check(phase != Phase.NEW) { "open() first" }
    try {
      decoder.feed(bytes, offset, length) { frame ->
        handle(frame)
        phase != Phase.CLOSED
      }
    } catch (e: ProtocolException) {
      close(CloseReason.BAD_FRAME)
    }
  }

  /** The stream ended. */
  fun onClosed() {
    if (phase == Phase.CLOSED) return
    close(if (decoder.hasPartial()) CloseReason.CUT_MID_FRAME else CloseReason.PEER_CLOSED)
  }

  /** Closes the session when the hello wait or the wait for a confirmation has run out on the injected clock. */
  fun tick() {
    val deadline = nextDeadline() ?: return
    if (clock.nowMillis() >= deadline) close(CloseReason.TIMEOUT)
  }

  /** When [tick] next has something to do, on the injected clock, or null when no timeout is running. */
  fun nextDeadline(): Long? = when (phase) {
    Phase.AWAITING_HELLO -> helloDeadline
    Phase.READY -> confirmDeadline
    else -> null
  }

  /** An item was queued: sends it now if the link is ready and nothing is outstanding. */
  fun wake() {
    if (phase == Phase.READY) pump()
  }

  fun close() = close(CloseReason.LOCAL)

  /** Ends the session for a reason only the layer below can see (TLS). */
  fun closeWith(reason: CloseReason) = close(reason)

  val isClosed: Boolean get() = phase == Phase.CLOSED

  /** Sends the next queued item if nothing is outstanding. Called only once the link is ready. */
  protected abstract fun pump()

  /** A message that is not hello or ping, in a ready link. */
  protected abstract fun onMessage(message: Message)

  /** Writes [message]; false when that closed the session. Failure to encode or write is the item's or the stream's, never the peer's. */
  protected fun send(message: Message): Boolean {
    try {
      val body = Messages.encode(message)
      val prefix = Framing.prefix(body.size)
      stream.write(prefix)
      stream.write(body)
    } catch (e: ProtocolException) {
      close(CloseReason.UNSENDABLE_ITEM, itemOf(message))
      return false
    } catch (e: Exception) {
      close(CloseReason.WRITE_FAILED)
      return false
    }
    return true
  }

  /** The wait for the confirmation of what was just written starts when the write returned, so a slow write is not the peer's delay. */
  protected fun armConfirm() {
    confirmDeadline = clock.nowMillis() + config.confirmTimeoutMs
  }

  protected fun disarmConfirm() {
    confirmDeadline = null
  }

  /** Tells the caller the peer refused one of this end's own items; the session is still open. */
  protected fun report(refusal: Refusal) {
    try {
      events.itemRefused(refusal)
    } catch (e: Exception) {
      // the caller could not set the item aside: it stays queued and is offered again next session, like any store failure
      close(CloseReason.STORE_FAILED, refusal.item)
    }
  }

  /** This end's own item that is offered and not yet confirmed, or null. */
  protected open fun inFlight(): ItemRef? = null

  protected fun close(reason: CloseReason, item: ItemRef? = null) {
    if (phase == Phase.CLOSED) return
    phase = Phase.CLOSED
    confirmDeadline = null
    try {
      stream.close()
    } catch (e: Exception) {
      // closing is best effort: the stream may already be gone, and the reason below is the news
    }
    events.closedWith(CloseInfo(reason, item, inFlight()))
  }

  private fun itemOf(message: Message): ItemRef? = when (message) {
    is RouteOffer -> ItemRef(ItemKind.ROUTE, message.routeId)
    is ActivityOffer -> ItemRef(ItemKind.ACTIVITY, message.activityId)
    else -> null
  }

  private fun handle(frame: ByteArray) {
    val message = try {
      Messages.parse(frame)
    } catch (e: ProtocolException) {
      close(CloseReason.BAD_FRAME)
      return
    }
    when (phase) {
      Phase.AWAITING_HELLO -> {
        if (message !is Hello) return close(CloseReason.UNEXPECTED_MESSAGE)
        // Our hello went out when the link opened, so the rule for no common version (answer with our own hello, then close) is already met.
        if (Protocol.negotiate(message.versions) == null) return close(CloseReason.NO_COMMON_VERSION)
        phase = Phase.READY
        events.ready()
        pump()
      }
      Phase.READY -> when (message) {
        is Hello -> close(CloseReason.UNEXPECTED_MESSAGE)
        is Ping -> Unit
        else -> onMessage(message)
      }
      else -> Unit
    }
  }
}
