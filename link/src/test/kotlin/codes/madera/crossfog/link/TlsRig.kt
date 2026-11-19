package codes.madera.crossfog.link

import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine

/** A transport in memory: bytes written to one end are read at the other. */
class QueueStream : ByteStream {
  val queue = ArrayDeque<ByteArray>()
  var closed = false
  var writes = 0

  override fun write(bytes: ByteArray) {
    check(!closed) { "closed" }
    writes++
    queue.addLast(bytes.copyOf())
  }

  override fun close() {
    closed = true
  }
}

/** One end of a TLS session with the endpoint above it, as a caller would wire them. */
class Peer(
  identity: Identity,
  client: Boolean,
  val trust: PinningTrustManager,
  clock: Clock,
  config: LinkConfig,
  private val make: (ByteStream, LinkEvents) -> Endpoint,
  engine: SSLEngine = Tls.engine(identity, trust, client),
) : TlsListener {
  val out = QueueStream()
  val events = RecordingEvents()
  val session = TlsSession(out, engine, trust, clock, config, this)
  var endpoint: Endpoint? = null
  var secured = false
  var end: TlsEnd? = null
  var failureAtEnd: TlsFailure? = null
  var plainBytes = 0

  override fun onSecure() {
    secured = true
    endpoint = make(session, events).also { it.open() }
  }

  override fun onPlain(bytes: ByteArray, offset: Int, length: Int) {
    plainBytes += length
    endpoint?.onBytes(bytes, offset, length)
  }

  override fun onEnd(end: TlsEnd) {
    this.end = end
    failureAtEnd = session.failure
    if (end == TlsEnd.CLEAN) endpoint?.onClosed() else endpoint?.closeWith(end.reason)
  }
}

/** How a [Rig] hands transport bytes to the other end. */
enum class Chunking { WHOLE, ONE_BYTE, JOINED, SEVEN_BYTES }

/** Two peers joined by memory, with a filter on each direction that a test can use to drop or change bytes. */
class Rig(val server: Peer, val client: Peer) {
  /** How transport bytes reach the other end: as written, a byte at a time, all queued bytes as one read, or in 7-byte reads. Always at a nonzero offset. */
  var chunking = Chunking.WHOLE

  /** False withholds the end of the transport, so an end must come from what was said inside TLS. */
  var deliverEof = true

  var toServer: (ByteArray) -> ByteArray? = { it }
  var toClient: (ByteArray) -> ByteArray? = { it }
  private var serverEof = false
  private var clientEof = false

  private var cutting = false

  /** Drops what is in flight and ends both transports without a close_notify, as a lost connection does. */
  fun cut() {
    cutting = true
  }

  /** Opens both ends and moves bytes until nothing is left to move. */
  fun run(open: Boolean = true, rounds: Int = 500) {
    if (open) {
      server.session.open()
      client.session.open()
    }
    settle(rounds)
  }

  private fun drain(queue: ArrayDeque<ByteArray>, filter: (ByteArray) -> ByteArray?): List<ByteArray> {
    val kept = mutableListOf<ByteArray>()
    while (queue.isNotEmpty()) filter(queue.removeFirst())?.let { kept += it }
    return when (chunking) {
      Chunking.WHOLE -> kept
      Chunking.JOINED -> if (kept.isEmpty()) emptyList() else listOf(kept.fold(ByteArray(0)) { a, b -> a + b })
      Chunking.ONE_BYTE -> kept.flatMap { c -> c.map { byteArrayOf(it) } }
      // all queued bytes cut into pieces that start and end partway into a record
      Chunking.SEVEN_BYTES -> kept.fold(ByteArray(0)) { a, b -> a + b }.toList().chunked(7).map { it.toByteArray() }
    }
  }

  private fun push(to: TlsSession, bytes: ByteArray) {
    val padded = ByteArray(bytes.size + 3)
    System.arraycopy(bytes, 0, padded, 3, bytes.size)
    to.onBytes(padded, 3, bytes.size)
  }

  fun settle(rounds: Int = 500) {
    repeat(rounds) {
      if (cutting) {
        cutting = false
        client.out.queue.clear()
        server.out.queue.clear()
        server.session.onTransportClosed()
        client.session.onTransportClosed()
        return
      }
      var moved = false
      for (chunk in drain(client.out.queue, toServer)) {
        moved = true
        if (!cutting) push(server.session, chunk)
      }
      for (chunk in drain(server.out.queue, toClient)) {
        moved = true
        if (!cutting) push(client.session, chunk)
      }
      if (deliverEof && !cutting && client.out.closed && client.out.queue.isEmpty() && !serverEof) {
        serverEof = true
        moved = true
        server.session.onTransportClosed()
      }
      if (deliverEof && !cutting && server.out.closed && server.out.queue.isEmpty() && !clientEof) {
        clientEof = true
        moved = true
        client.session.onTransportClosed()
      }
      if (!moved && !cutting) return
    }
    error("did not settle")
  }
}

/** An engine for the given role that offers only [protocols] (TLS 1.2 by default), over the same identity and trust, to show a peer that offers less is refused. */
fun tls12Engine(identity: Identity, trust: PinningTrustManager, client: Boolean, protocols: Array<String> = arrayOf("TLSv1.2")): SSLEngine {
  val context = SSLContext.getInstance("TLS")
  val keys = javax.net.ssl.KeyManagerFactory.getInstance("SunX509")
  val store = java.security.KeyStore.getInstance("PKCS12").apply { load(null, null) }
  store.setKeyEntry("k", identity.key, charArrayOf(), identity.chain.toTypedArray())
  keys.init(store, charArrayOf())
  context.init(keys.keyManagers, arrayOf(trust), null)
  return context.createSSLEngine().apply {
    useClientMode = client
    enabledProtocols = protocols
    if (!client) needClientAuth = true
  }
}

/** The normal session: the phone is the TLS server, the watch the TLS client. */
class NormalRig(
  val phoneId: Identity = TestKeys.phone,
  val watchId: Identity = TestKeys.watch,
  val phonePins: PinStore = MemoryPins(TestKeys.watch.spkiHash()),
  val watchPins: PinStore = MemoryPins(TestKeys.phone.spkiHash()),
  val clock: FakeClock = FakeClock(),
  val config: LinkConfig = LinkConfig(),
) {
  val phoneRoutes = FakePhoneRoutes()
  val sink = FakeSink()
  val watchRoutes = FakeWatchRoutes()
  val outbox = FakeOutbox()
  val phone = Peer(phoneId, false, PinningTrustManager.pinned(phonePins), clock, config, { s, e -> PhoneEndpoint(s, clock, phoneRoutes, sink, e, config) })
  val watch = Peer(watchId, true, PinningTrustManager.pinned(watchPins), clock, config, { s, e -> WatchEndpoint(s, clock, watchRoutes, outbox, e, config) })
  val rig = Rig(phone, watch)
}

/** The pairing session: the watch is the TLS server and shows the QR, the phone the TLS client. */
class PairRig(
  val clock: FakeClock = FakeClock(),
  val config: LinkConfig = LinkConfig(),
  val offer: PairingOffer = PairingOffer(clock, config),
  val watchId: Identity = TestKeys.watch,
  val phoneId: Identity = TestKeys.phone,
  val watchPins: PinStore = MemoryPins(),
  val phonePins: PinStore = MemoryPins(),
  val qr: QrPayload = offer.payload(watchId.spkiHash(), "tcp:192.168.1.5:4242"),
  phoneTrustExpects: ByteArray = qr.watchHash,
  /** Cut the connection right after the watch (true) or the phone (false) wrote the message of this class name. */
  private val cutAfter: Pair<Boolean, String>? = null,
) {
  private fun tap(stream: ByteStream, watchSide: Boolean): ByteStream =
    if (cutAfter != null && cutAfter.first == watchSide) Tap(stream, cutAfter.second) { rig.cut() } else stream

  private val watchTrust = PinningTrustManager.acceptingAnyKey()
  val watch = Peer(watchId, false, watchTrust, clock, config, { s, e ->
    WatchPairingEndpoint(tap(s, true), clock, e, config, offer, watchId.spkiHash(), { watchTrust.peerHash }, watchPins)
  })
  lateinit var phoneEndpoint: PhonePairingEndpoint
  val phone = Peer(phoneId, true, PinningTrustManager.expecting(phoneTrustExpects), clock, config, { s, e ->
    PhonePairingEndpoint(tap(s, false), clock, e, config, qr, phoneId.spkiHash(), phonePins).also { phoneEndpoint = it }
  })
  val rig = Rig(watch, phone)
}

/** Passes writes through and calls [onSent] after the frame of the message named [type] has been written. */
class Tap(private val inner: ByteStream, private val type: String, private val onSent: () -> Unit) : ByteStream {
  private var expecting = true

  override fun write(bytes: ByteArray) {
    inner.write(bytes)
    if (expecting) {
      expecting = false
      return
    }
    expecting = true
    if (Messages.parse(bytes)::class.simpleName == type) onSent()
  }

  override fun close() = inner.close()
}
