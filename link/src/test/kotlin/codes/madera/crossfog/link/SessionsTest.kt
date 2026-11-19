package codes.madera.crossfog.link

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionsTest {
  private val clock = FakeClock()
  private val config = LinkConfig()

  private fun normal(phonePins: PinStore, watchPins: PinStore, phoneId: Identity = TestKeys.phone, watchId: Identity = TestKeys.watch): NormalSides {
    val s = NormalSides()
    s.phone = Sessions.normalPhone(s.phoneOut, phoneId, phonePins, s.routes, s.sink, clock, config, s.phoneEvents)
    s.watch = Sessions.normalWatch(s.watchOut, watchId, watchPins, s.watchRoutes, s.outbox, clock, config, s.watchEvents)
    s.rig = Rig(BuiltSide(s.phone, s.phoneOut), BuiltSide(s.watch, s.watchOut))
    return s
  }

  class NormalSides {
    val phoneOut = QueueStream()
    val watchOut = QueueStream()
    val routes = FakePhoneRoutes()
    val sink = FakeSink()
    val watchRoutes = FakeWatchRoutes()
    val outbox = FakeOutbox()
    val phoneEvents = InfoEvents()
    val watchEvents = InfoEvents()
    lateinit var phone: SecureSession
    lateinit var watch: SecureSession
    lateinit var rig: Rig
  }

  @Test
  fun aNormalSessionMovesARouteAndAnActivityOverTls() {
    val s = normal(MemoryPins(TestKeys.watch.spkiHash()), MemoryPins(TestKeys.phone.spkiHash()))
    s.routes.queue(route(ROUTE_A))
    s.outbox.queue(activity(ACT_1))
    s.rig.run()
    assertEquals(listOf(ROUTE_A), s.routes.delivered.map { it.first })
    assertTrue(ACT_1 in s.sink.stored)
    assertTrue(s.outbox.queued.isEmpty())
    assertEquals(1, s.phoneEvents.ready)
    assertEquals(1, s.watchEvents.ready)
  }

  @Test
  fun aNormalSessionWorksWhenTheBytesComeInAnyPieces() {
    for (chunking in Chunking.values()) {
      val s = normal(MemoryPins(TestKeys.watch.spkiHash()), MemoryPins(TestKeys.phone.spkiHash()))
      s.rig.chunking = chunking
      s.routes.queue(route(ROUTE_A))
      s.rig.run()
      assertEquals("$chunking", 1, s.routes.delivered.size)
    }
  }

  @Test
  fun anItemQueuedWhileIdleGoesOutOnWake() {
    val s = normal(MemoryPins(TestKeys.watch.spkiHash()), MemoryPins(TestKeys.phone.spkiHash()))
    s.rig.run()
    s.routes.queue(route(ROUTE_A))
    s.phone.wake()
    s.rig.settle()
    assertEquals(1, s.routes.delivered.size)
  }

  @Test
  fun aWatchThatDoesNotPinThePhoneIsRefusedAndNeverReportsReady() {
    val s = normal(MemoryPins(TestKeys.watch.spkiHash()), MemoryPins(TestKeys.attacker.spkiHash()))
    s.routes.queue(route(ROUTE_A))
    s.rig.run()
    assertEquals(0, s.phoneEvents.ready)
    assertEquals(0, s.watchEvents.ready)
    assertTrue(s.routes.delivered.isEmpty())
    for (info in s.phoneEvents.infos + s.watchEvents.infos) assertNull(info.inFlight)
    assertTrue(s.watchEvents.infos.single().reason in setOf(CloseReason.TLS_FAILED, CloseReason.TLS_REFUSED))
  }

  @Test
  fun aSessionThatEndsBeforeTheHandshakeIsDoneReportsItsReasonOnce() {
    val s = normal(MemoryPins(TestKeys.watch.spkiHash()), MemoryPins(TestKeys.phone.spkiHash()))
    s.phone.open()
    s.phone.onTransportClosed()
    assertEquals(1, s.phoneEvents.infos.size)
    assertEquals(0, s.phoneEvents.ready)
  }

  @Test
  fun aCutAfterTheOfferNamesTheRouteInFlightOnThePhone() {
    val s = normal(MemoryPins(TestKeys.watch.spkiHash()), MemoryPins(TestKeys.phone.spkiHash()))
    s.routes.queue(route(ROUTE_A))
    s.watchRoutes.failIds += ROUTE_A
    s.rig.deliverEof = true
    s.rig.run()
    val phoneEnd = s.phoneEvents.infos.single()
    assertEquals(ItemRef(ItemKind.ROUTE, ROUTE_A), phoneEnd.inFlight)
    assertEquals(ItemRef(ItemKind.ROUTE, ROUTE_A), s.watchEvents.infos.single().failed)
  }

  @Test
  fun nextDeadlineIsTheHandshakeWaitAndNothingOnceTheSessionIsOver() {
    val s = normal(MemoryPins(TestKeys.watch.spkiHash()), MemoryPins(TestKeys.phone.spkiHash()))
    s.outbox.queue(activity(ACT_1))
    s.sink.fail = true
    // a client's handshake clock starts when it opens
    s.watch.open()
    assertEquals(clock.nowMillis() + config.handshakeTimeoutMs, s.watch.nextDeadline())
    s.phone.open()
    s.rig.run(open = false)
    // the sink threw, so the session is over and no timer runs
    assertNull(s.watch.nextDeadline())
  }

  @Test
  fun aPairingSessionCommitsBothPinsOverTls() {
    val offer = PairingOffer(clock, config)
    val watchPins = MemoryPins()
    val phonePins = MemoryPins()
    val qr = offer.payload(TestKeys.watch.spkiHash(), "tcp:192.168.1.5:4242")
    val watchOut = QueueStream()
    val phoneOut = QueueStream()
    val watchEvents = InfoEvents()
    val phoneEvents = InfoEvents()
    val watch = Sessions.pairingWatch(watchOut, TestKeys.watch, offer, watchPins, clock, config, watchEvents)
    val phone = Sessions.pairingPhone(phoneOut, TestKeys.phone, qr, phonePins, clock, config, phoneEvents)
    Rig(BuiltSide(watch, watchOut), BuiltSide(phone, phoneOut)).run()
    assertArrayEquals(TestKeys.phone.spkiHash(), watchPins.get())
    assertArrayEquals(TestKeys.watch.spkiHash(), phonePins.get())
    assertEquals(CloseReason.PAIRING_COMPLETE, watchEvents.infos.single().reason)
    assertEquals(CloseReason.PAIRING_COMPLETE, phoneEvents.infos.single().reason)
  }

  @Test
  fun aPhoneThatScannedAnotherWatchesQrPairsNothing() {
    val offer = PairingOffer(clock, config)
    val watchPins = MemoryPins()
    val phonePins = MemoryPins()
    val qr = offer.payload(TestKeys.attacker.spkiHash(), "rfcomm")
    val watchOut = QueueStream()
    val phoneOut = QueueStream()
    val watchEvents = InfoEvents()
    val phoneEvents = InfoEvents()
    val watch = Sessions.pairingWatch(watchOut, TestKeys.watch, offer, watchPins, clock, config, watchEvents)
    val phone = Sessions.pairingPhone(phoneOut, TestKeys.phone, qr, phonePins, clock, config, phoneEvents)
    Rig(BuiltSide(watch, watchOut), BuiltSide(phone, phoneOut)).run()
    assertNull(watchPins.get())
    assertNull(phonePins.get())
    assertEquals(0, phoneEvents.ready)
  }
}
