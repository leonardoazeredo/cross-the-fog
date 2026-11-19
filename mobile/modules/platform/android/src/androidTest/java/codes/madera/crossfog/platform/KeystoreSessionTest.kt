package codes.madera.crossfog.platform

import androidx.test.ext.junit.runners.AndroidJUnit4
import codes.madera.crossfog.link.ActivityOffer
import codes.madera.crossfog.link.ActivityOutbox
import codes.madera.crossfog.link.ActivitySink
import codes.madera.crossfog.link.ByteStream
import codes.madera.crossfog.link.Clock
import codes.madera.crossfog.link.CloseInfo
import codes.madera.crossfog.link.CloseReason
import codes.madera.crossfog.link.Identity
import codes.madera.crossfog.link.LinkConfig
import codes.madera.crossfog.link.LinkEvents
import codes.madera.crossfog.link.PhoneRouteStore
import codes.madera.crossfog.link.PinStore
import codes.madera.crossfog.link.PinningTrustManager
import codes.madera.crossfog.link.RouteOffer
import codes.madera.crossfog.link.SaveResult
import codes.madera.crossfog.link.SecureSession
import codes.madera.crossfog.link.Sessions
import codes.madera.crossfog.link.Tls
import codes.madera.crossfog.link.WatchRouteStore
import codes.madera.crossfog.link.spkiHash
import java.nio.ByteBuffer
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLEngineResult
import javax.net.ssl.SSLException
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * What only Android's TLS stack (Conscrypt) and Keystore keys can show, for the normal session and the
 * refusals around it: a pinned session carries a route and an activity with both ends signing through
 * the Keystore, a client the server does not pin learns it was refused only after its own handshake
 * finished, a TLS 1.2 offer is refused, and the names Conscrypt reports for TLS 1.3. The pairing
 * session and the key hash each end computes for itself are in [KeystoreIdentityTest].
 */
@RunWith(AndroidJUnit4::class)
class KeystoreSessionTest {
  private val aliases = listOf("crossfog.link.test.session.phone", "crossfog.link.test.session.watch", "crossfog.link.test.session.other")
  private val phone: Identity by lazy { KeystoreIdentity.loadOrCreate(aliases[0]) }
  private val watch: Identity by lazy { KeystoreIdentity.loadOrCreate(aliases[1]) }
  private val other: Identity by lazy { KeystoreIdentity.loadOrCreate(aliases[2]) }
  private val clock = object : Clock {
    override fun nowMillis() = 0L
  }
  private val config = LinkConfig()

  @After
  fun cleanUp() = aliases.forEach { KeystoreIdentity.delete(it) }

  private class Pins(var pin: ByteArray?) : PinStore {
    override fun get() = pin?.copyOf()

    override fun put(pin: ByteArray) {
      this.pin = pin.copyOf()
    }

    override fun clear() {
      pin = null
    }
  }

  private class Pipe : ByteStream {
    val queue = ArrayDeque<ByteArray>()
    var closed = false

    override fun write(bytes: ByteArray) {
      queue.addLast(bytes.copyOf())
    }

    override fun close() {
      closed = true
    }
  }

  private class Events : LinkEvents {
    val ends = mutableListOf<CloseInfo>()
    var ready = 0

    override fun ready() {
      ready++
    }

    override fun closed(reason: CloseReason, itemId: String?) = Unit

    override fun closedWith(info: CloseInfo) {
      ends += info
    }
  }

  private class PhoneRoutes(private val route: RouteOffer) : PhoneRouteStore {
    val delivered = mutableListOf<String>()

    override fun nextQueued() = if (route.routeId in delivered) null else route

    override fun markDelivered(routeId: String, revision: String): Boolean {
      if (routeId != route.routeId || revision != route.revision || routeId in delivered) return false
      delivered += routeId
      return true
    }
  }

  private class Sink : ActivitySink {
    val stored = linkedMapOf<String, ActivityOffer>()

    override fun store(offer: ActivityOffer): SaveResult =
      if (stored.putIfAbsent(offer.activityId, offer) == null) SaveResult.SAVED else SaveResult.ALREADY_HELD
  }

  private class WatchRoutes : WatchRouteStore {
    val saved = linkedMapOf<String, RouteOffer>()

    override fun save(offer: RouteOffer): SaveResult =
      if (saved.put(offer.routeId, offer)?.revision == offer.revision) SaveResult.ALREADY_HELD else SaveResult.SAVED
  }

  private class Outbox(private var item: ActivityOffer?) : ActivityOutbox {
    val deleted = mutableListOf<String>()

    override fun next() = item

    override fun delete(activityId: String) {
      if (item?.activityId == activityId) item = null
      deleted += activityId
    }
  }

  private val route = RouteOffer("11111111-1111-4111-8111-111111111111", "Test route", "2026-01-02T03:04:05Z", "<gpx>route</gpx>")
  private val walk = ActivityOffer("22222222-2222-4222-8222-222222222221", null, "1", "<gpx>walk</gpx>")

  /** Carries bytes both ways until neither side writes any more. */
  private fun settle(watch: SecureSession, watchOut: Pipe, phone: SecureSession, phoneOut: Pipe) {
    watch.open()
    phone.open()
    var watchToldOfClose = false
    var phoneToldOfClose = false
    repeat(400) {
      var moved = false
      while (phoneOut.queue.isNotEmpty()) {
        moved = true
        phoneOut.queue.removeFirst().let { watch.onBytes(it, 0, it.size) }
      }
      while (watchOut.queue.isNotEmpty()) {
        moved = true
        watchOut.queue.removeFirst().let { phone.onBytes(it, 0, it.size) }
      }
      // A closed stream ends the socket at the other end, once what was written before it has been read.
      if (phoneOut.closed && !watchToldOfClose) {
        watchToldOfClose = true
        moved = true
        watch.onTransportClosed()
      }
      if (watchOut.closed && !phoneToldOfClose) {
        phoneToldOfClose = true
        moved = true
        phone.onTransportClosed()
      }
      if (!moved) return
    }
    error("did not settle")
  }

  @Test
  fun aPinnedNormalSessionCarriesARouteAndAnActivityWithBothEndsSigningThroughTheKeystore() {
    val routes = PhoneRoutes(route)
    val sink = Sink()
    val watchRoutes = WatchRoutes()
    val outbox = Outbox(walk)
    val phoneEvents = Events()
    val watchEvents = Events()
    val phoneOut = Pipe()
    val watchOut = Pipe()
    val phoneSession = Sessions.normalPhone(phoneOut, phone, Pins(watch.spkiHash()), routes, sink, clock, config, phoneEvents)
    val watchSession = Sessions.normalWatch(watchOut, watch, Pins(phone.spkiHash()), watchRoutes, outbox, clock, config, watchEvents)
    settle(watchSession, watchOut, phoneSession, phoneOut)
    assertEquals(listOf(route.routeId), routes.delivered)
    assertEquals(route, watchRoutes.saved[route.routeId])
    assertEquals(walk, sink.stored[walk.activityId])
    assertEquals(listOf(walk.activityId), outbox.deleted)
    assertEquals(1, phoneEvents.ready)
    assertEquals(1, watchEvents.ready)
  }

  @Test
  fun aWatchTheServerDoesNotPinHandshakesFirstThenIsToldItWasRefusedAndNothingReachesTheSink() {
    val sink = Sink()
    val watchEvents = Events()
    val phoneEvents = Events()
    val phoneOut = Pipe()
    val watchOut = Pipe()
    val phoneSession = Sessions.normalPhone(phoneOut, phone, Pins(other.spkiHash()), PhoneRoutes(route), sink, clock, config, phoneEvents)
    val watchSession = Sessions.normalWatch(watchOut, watch, Pins(phone.spkiHash()), WatchRoutes(), Outbox(walk), clock, config, watchEvents)
    settle(watchSession, watchOut, phoneSession, phoneOut)
    assertTrue(sink.stored.isEmpty())
    assertEquals(0, phoneEvents.ready)
    // TLS 1.3 lets the client finish first, so the refusal reaches it as an alert, never as a message.
    assertEquals(listOf(CloseReason.TLS_REFUSED), watchEvents.ends.map { it.reason })
  }

  @Test
  fun aServerThatIsNotThePinnedKeyIsRefusedByTheClientBeforeItsEndpointOpens() {
    val sink = Sink()
    val watchEvents = Events()
    val phoneEvents = Events()
    val phoneOut = Pipe()
    val watchOut = Pipe()
    val phoneSession = Sessions.normalPhone(phoneOut, phone, Pins(watch.spkiHash()), PhoneRoutes(route), sink, clock, config, phoneEvents)
    val watchSession = Sessions.normalWatch(watchOut, watch, Pins(other.spkiHash()), WatchRoutes(), Outbox(walk), clock, config, watchEvents)
    settle(watchSession, watchOut, phoneSession, phoneOut)
    assertEquals(0, watchEvents.ready)
    assertTrue(sink.stored.isEmpty())
    assertEquals(1, watchEvents.ends.size)
    assertFalse(watchEvents.ends.single().reason == CloseReason.PEER_CLOSED)
  }

  /** A TLS client driven by hand against a phone session, so its negotiated protocol can be read. */
  private class RawClient(val engine: SSLEngine) {
    var failure: SSLException? = null

    fun handshake(server: SecureSession, serverOut: Pipe) {
      server.open()
      engine.beginHandshake()
      val net = ByteBuffer.allocate(engine.session.packetBufferSize)
      val app = ByteBuffer.allocate(engine.session.applicationBufferSize)
      var inbound = ByteBuffer.allocate(0)
      try {
        repeat(200) {
          when (engine.handshakeStatus) {
            SSLEngineResult.HandshakeStatus.NEED_TASK -> {
              // Conscrypt may report NEED_TASK with no task to take; the engine then carries on.
              while (true) (engine.delegatedTask ?: break).run()
            }
            SSLEngineResult.HandshakeStatus.NEED_WRAP -> {
              net.clear()
              engine.wrap(ByteBuffer.allocate(0), net)
              net.flip()
              val out = ByteArray(net.remaining()).also { net.get(it) }
              if (out.isNotEmpty()) server.onBytes(out, 0, out.size)
            }
            SSLEngineResult.HandshakeStatus.NEED_UNWRAP -> {
              if (!inbound.hasRemaining() && serverOut.queue.isNotEmpty()) inbound = ByteBuffer.wrap(serverOut.queue.removeFirst())
              if (!inbound.hasRemaining()) return
              app.clear()
              engine.unwrap(inbound, app)
            }
            else -> return
          }
        }
      } catch (e: SSLException) {
        failure = e
      }
    }
  }

  private fun rawClient(protocols: Array<String>): RawClient {
    val trust = PinningTrustManager.pinned(Pins(phone.spkiHash()))
    val engine = Tls.engine(watch, trust, client = true).apply { enabledProtocols = protocols }
    return RawClient(engine)
  }

  @Test
  fun conscryptNegotiatesTls13WithASuiteTheLinkAcceptsAndTheServerGoesReady() {
    val events = Events()
    val serverOut = Pipe()
    val server = Sessions.normalPhone(serverOut, phone, Pins(watch.spkiHash()), PhoneRoutes(route), Sink(), clock, config, events)
    val client = rawClient(arrayOf("TLSv1.3"))
    client.handshake(server, serverOut)
    assertNull(client.failure)
    assertEquals("TLSv1.3", client.engine.session.protocol)
    assertTrue(client.engine.session.cipherSuite, client.engine.session.cipherSuite in setOf("TLS_AES_128_GCM_SHA256", "TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256"))
    assertNotNull(client.engine.session.peerCertificates.firstOrNull())
    assertEquals(phone.spkiHash().toList(), codes.madera.crossfog.link.Spki.hash(client.engine.session.peerCertificates.first() as java.security.cert.X509Certificate).toList())
  }

  @Test
  fun aClientThatOffersOnlyTls12IsRefusedAndTheServerNeverGoesReady() {
    val events = Events()
    val serverOut = Pipe()
    val server = Sessions.normalPhone(serverOut, phone, Pins(watch.spkiHash()), PhoneRoutes(route), Sink(), clock, config, events)
    val client = rawClient(arrayOf("TLSv1.2"))
    client.handshake(server, serverOut)
    assertEquals(0, events.ready)
    // The phone ends the session as a TLS failure and closes its stream; the client never finishes a handshake.
    assertEquals(listOf(CloseReason.TLS_FAILED), events.ends.map { it.reason })
    assertTrue(serverOut.closed)
    assertEquals("NONE", client.engine.session.protocol)
  }
}
