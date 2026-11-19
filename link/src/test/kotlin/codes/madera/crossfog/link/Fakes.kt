package codes.madera.crossfog.link

import java.io.IOException

const val ROUTE_A = "11111111-1111-4111-8111-111111111111"
const val ROUTE_B = "11111111-1111-4111-8111-111111111112"
const val ROUTE_C = "11111111-1111-4111-8111-111111111113"
const val ACT_1 = "22222222-2222-4222-8222-222222222221"
const val ACT_2 = "22222222-2222-4222-8222-222222222222"
const val ACT_3 = "22222222-2222-4222-8222-222222222223"

fun route(id: String = ROUTE_A, gpx: String = "<gpx>$id</gpx>") = RouteOffer(id, "Test route", "2026-01-02T03:04:05Z", gpx)

fun activity(id: String = ACT_1, routeId: String? = null, gpx: String = "<gpx>$id</gpx>") = ActivityOffer(id, routeId, "1", gpx)

class FakeClock(var now: Long = 0) : Clock {
  override fun nowMillis() = now
}

/** One end of an in-memory stream: what an endpoint writes is kept as raw bytes, which the test takes as bytes to move or as decoded messages. */
class MemoryStream : ByteStream {
  private val written = java.io.ByteArrayOutputStream()
  var closed = false
  var closeCalls = 0
  var failWrites = false

  override fun write(bytes: ByteArray) {
    if (failWrites) throw IOException("write failed")
    written.write(bytes)
  }

  override fun close() {
    closed = true
    closeCalls++
  }

  /** Everything written since the last call. */
  fun take(): ByteArray = written.toByteArray().also { written.reset() }

  /** The messages written since the last call; fails the test on a partial frame. */
  fun takeMessages(): List<Message> {
    val bytes = take()
    val out = mutableListOf<Message>()
    val input = bytes.inputStream()
    while (true) {
      val frame = Framing.readFrame(input) ?: break
      out += Messages.parse(frame)
    }
    return out
  }
}

class RecordingEvents : LinkEvents {
  val closed = mutableListOf<CloseReason>()
  val itemIds = mutableListOf<String?>()
  val log = mutableListOf<String>()
  var ready = 0

  override fun ready() {
    ready++
    log += "ready"
  }

  override fun closed(reason: CloseReason, itemId: String?) {
    closed += reason
    itemIds += itemId
    log += "closed:$reason"
  }
}

/** The phone's outbox: queued and delivered routes, delivery compare-and-marked on (id, revision). */
class FakePhoneRoutes : PhoneRouteStore {
  val queued = linkedMapOf<String, RouteOffer>()
  val delivered = mutableListOf<Pair<String, String>>()
  var failMark = false

  fun queue(offer: RouteOffer) {
    queued[offer.routeId] = offer
  }

  override fun nextQueued(): RouteOffer? = queued.values.firstOrNull()

  override fun markDelivered(routeId: String, revision: String): Boolean {
    if (failMark) throw IllegalStateException("store failed")
    val current = queued[routeId] ?: return false
    if (current.revision != revision) return false
    queued.remove(routeId)
    delivered += routeId to revision
    return true
  }
}

class FakeSink : ActivitySink {
  val stored = linkedMapOf<String, ActivityOffer>()
  var writes = 0
  var fail = false

  override fun store(offer: ActivityOffer): SaveResult {
    if (fail) throw IllegalStateException("sink failed")
    if (offer.activityId in stored) return SaveResult.ALREADY_HELD
    writes++
    stored[offer.activityId] = offer
    return SaveResult.SAVED
  }
}

class FakeWatchRoutes : WatchRouteStore {
  val saved = linkedMapOf<String, RouteOffer>()
  var writes = 0
  var fail = false

  override fun save(offer: RouteOffer): SaveResult {
    if (fail) throw IllegalStateException("store failed")
    val held = saved[offer.routeId]
    if (held != null && held.revision == offer.revision) return SaveResult.ALREADY_HELD
    writes++
    saved[offer.routeId] = offer
    return SaveResult.SAVED
  }
}

class FakeOutbox : ActivityOutbox {
  val queued = linkedMapOf<String, ActivityOffer>()
  val deleted = mutableListOf<String>()
  var failDelete = false
  var failNext = false

  fun queue(offer: ActivityOffer) {
    queued[offer.activityId] = offer
  }

  override fun next(): ActivityOffer? = if (failNext) throw IllegalStateException("store failed") else queued.values.firstOrNull()

  override fun delete(activityId: String) {
    if (failDelete) throw IllegalStateException("store failed")
    queued.remove(activityId)
    deleted += activityId
  }
}

/** A phone and a watch endpoint over two memory streams, and the means to carry bytes between them. */
class Pair2(
  val clock: FakeClock = FakeClock(),
  val phoneRoutes: FakePhoneRoutes = FakePhoneRoutes(),
  val sink: FakeSink = FakeSink(),
  val watchRoutes: FakeWatchRoutes = FakeWatchRoutes(),
  val outbox: FakeOutbox = FakeOutbox(),
  val config: LinkConfig = LinkConfig(),
) {
  val phoneStream = MemoryStream()
  val watchStream = MemoryStream()
  val phoneEvents = RecordingEvents()
  val watchEvents = RecordingEvents()
  val phone = PhoneEndpoint(phoneStream, clock, phoneRoutes, sink, phoneEvents, config)
  val watch = WatchEndpoint(watchStream, clock, watchRoutes, outbox, watchEvents, config)

  /** Moves whatever each side wrote to the other, until neither writes anything more. Returns the frames moved. */
  fun run(chunk: Int = Int.MAX_VALUE, maxRounds: Int = 100): List<Message> {
    val moved = mutableListOf<Message>()
    repeat(maxRounds) {
      val toWatch = phoneStream.take()
      val toPhone = watchStream.take()
      if (toWatch.isEmpty() && toPhone.isEmpty()) return moved
      moved += decodeAll(toWatch) + decodeAll(toPhone)
      feed(watch, toWatch, chunk)
      feed(phone, toPhone, chunk)
    }
    error("the endpoints never went quiet")
  }

  fun open() {
    phone.open()
    watch.open()
  }

  private fun decodeAll(bytes: ByteArray): List<Message> {
    val input = bytes.inputStream()
    val out = mutableListOf<Message>()
    while (true) out += Messages.parse(Framing.readFrame(input) ?: break)
    return out
  }

  companion object {
    fun feed(endpoint: Endpoint, bytes: ByteArray, chunk: Int) {
      var at = 0
      while (at < bytes.size) {
        val n = minOf(chunk, bytes.size - at)
        endpoint.onBytes(bytes, at, n)
        at += n
      }
    }
  }
}

fun frame(message: Message): ByteArray = Framing.encode(Messages.encode(message))

fun frameOf(json: String): ByteArray = Framing.encode(json.toByteArray())

fun Endpoint.feed(vararg messages: Message) {
  for (m in messages) {
    val bytes = frame(m)
    onBytes(bytes, 0, bytes.size)
  }
}

val HELLO = Hello(listOf(1))

/** One endpoint and everything around it, for tests that play the peer by hand. */
class Solo(val config: LinkConfig = LinkConfig(), val clock: FakeClock = FakeClock()) {
  val stream = MemoryStream()
  val events = RecordingEvents()
  val phoneRoutes = FakePhoneRoutes()
  val sink = FakeSink()
  val watchRoutes = FakeWatchRoutes()
  val outbox = FakeOutbox()

  fun phone() = PhoneEndpoint(stream, clock, phoneRoutes, sink, events, config)

  fun watch() = WatchEndpoint(stream, clock, watchRoutes, outbox, events, config)

  /** Opens [endpoint], plays the peer's hello and drops our own hello from the stream. */
  fun ready(endpoint: Endpoint): Endpoint {
    endpoint.open()
    endpoint.feed(HELLO)
    val sent = stream.takeMessages()
    check(sent.firstOrNull() == HELLO) { "our hello comes first" }
    pending = sent.drop(1)
    return endpoint
  }

  /** What was written after our hello, in the call that made the endpoint ready. */
  var pending: List<Message> = emptyList()
}
