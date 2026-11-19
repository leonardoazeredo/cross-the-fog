package codes.madera.crossfog.link

import javax.net.ssl.SSLEngine

/**
 * TLS and the endpoint above it as one thing an app drives: it feeds transport bytes to [onBytes],
 * the end of the transport to [onTransportClosed], and calls [tick] when [nextDeadline] has passed
 * and [wake] when an item was queued, one at a time like an [Endpoint]. The endpoint is created, and
 * opened, only once the handshake is done and TLS 1.3 is confirmed; a session that ends before that
 * (a refused key, a handshake that failed) tells [events] it closed, with the TLS reason, and never
 * reports ready.
 *
 * Build one with [Sessions]; the trust manager and the engine belong to one session.
 */
class SecureSession internal constructor(
  raw: ByteStream,
  engine: SSLEngine,
  private val trust: PinningTrustManager,
  clock: Clock,
  config: LinkConfig,
  private val events: LinkEvents,
  private val makeEndpoint: (ByteStream, LinkEvents) -> Endpoint,
) {
  private var endpoint: Endpoint? = null
  private var reported = false
  private val tls: TlsSession = TlsSession(raw, engine, trust, clock, config, object : TlsListener {
    override fun onSecure() {
      // Set before open(): a hello that fails to write closes the endpoint inside open(), and a close from the app's handler must find it.
      val e = makeEndpoint(tls, events)
      endpoint = e
      e.open()
    }

    override fun onPlain(bytes: ByteArray, offset: Int, length: Int) {
      endpoint?.onBytes(bytes, offset, length)
    }

    override fun onEnd(end: TlsEnd) {
      val e = endpoint
      when {
        e == null -> {
          reported = true
          events.closedWith(CloseInfo(end.reason, null, null))
        }
        end == TlsEnd.CLEAN -> e.onClosed()
        else -> e.closeWith(end.reason)
      }
    }
  })

  /** Why TLS refused the peer, when this end knows; see [TlsSession.failure]. */
  val failure: TlsFailure? get() = tls.failure

  fun open() = tls.open()

  fun onBytes(bytes: ByteArray, offset: Int, length: Int) = tls.onBytes(bytes, offset, length)

  fun onTransportClosed() = tls.onTransportClosed()

  fun tick() {
    tls.tick()
    endpoint?.tick()
  }

  /** The nearer of the handshake deadline and the endpoint's, or null when no timeout is running. */
  fun nextDeadline(): Long? = listOfNotNull(tls.nextDeadline(), endpoint?.nextDeadline()).minOrNull()

  fun wake() {
    endpoint?.wake()
  }

  /** Ends the session with [CloseReason.LOCAL]: through the endpoint once there is one, else by closing the transport and reporting it here, once, unless TLS already reported an end. */
  fun close() {
    val e = endpoint
    if (e != null) return e.close()
    // TLS closes silently, and an app that frees its slot on the close event must hear about a cancel too.
    tls.close()
    if (!reported) {
      reported = true
      events.closedWith(CloseInfo(CloseReason.LOCAL, null, null))
    }
  }
}

/**
 * The four sessions, with the roles fixed: in a pairing session the watch is the TLS server (it shows
 * the QR and listens) and the phone the client; in a normal session the phone is the server. Each call
 * makes a new trust manager and engine, so nothing carries over between sessions.
 */
object Sessions {
  fun pairingWatch(raw: ByteStream, identity: Identity, offer: PairingOffer, pins: PinStore, clock: Clock, config: LinkConfig, events: LinkEvents): SecureSession {
    val trust = PinningTrustManager.acceptingAnyKey()
    return SecureSession(raw, Tls.engine(identity, trust, client = false), trust, clock, config, events) { s, e ->
      WatchPairingEndpoint(s, clock, e, config, offer, identity.spkiHash(), { trust.peerHash }, pins)
    }
  }

  fun pairingPhone(raw: ByteStream, identity: Identity, qr: QrPayload, pins: PinStore, clock: Clock, config: LinkConfig, events: LinkEvents): SecureSession {
    val trust = PinningTrustManager.expecting(qr.watchHash)
    return SecureSession(raw, Tls.engine(identity, trust, client = true), trust, clock, config, events) { s, e ->
      PhonePairingEndpoint(s, clock, e, config, qr, identity.spkiHash(), pins)
    }
  }

  fun normalPhone(raw: ByteStream, identity: Identity, pins: PinStore, routes: PhoneRouteStore, sink: ActivitySink, clock: Clock, config: LinkConfig, events: LinkEvents): SecureSession {
    val trust = PinningTrustManager.pinned(pins)
    return SecureSession(raw, Tls.engine(identity, trust, client = false), trust, clock, config, events) { s, e ->
      PhoneEndpoint(s, clock, routes, sink, e, config)
    }
  }

  fun normalWatch(raw: ByteStream, identity: Identity, pins: PinStore, routes: WatchRouteStore, outbox: ActivityOutbox, clock: Clock, config: LinkConfig, events: LinkEvents): SecureSession {
    val trust = PinningTrustManager.pinned(pins)
    return SecureSession(raw, Tls.engine(identity, trust, client = true), trust, clock, config, events) { s, e ->
      WatchEndpoint(s, clock, routes, outbox, e, config)
    }
  }
}
