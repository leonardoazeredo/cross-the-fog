package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TlsSessionTest {
  @Test
  fun aPinnedSessionIsSecureOnTls13AndBothEndpointsOpen() {
    val n = NormalRig()
    n.rig.run()
    assertTrue(n.phone.secured && n.watch.secured)
    assertEquals(1, n.phone.events.ready)
    assertEquals(1, n.watch.events.ready)
    assertEquals("TLSv1.3", n.phone.session.protocolForTest())
  }

  @Test
  fun aUnpairedWatchIsRefusedAndNoByteReachesThePhoneEndpoint() {
    val n = NormalRig(phonePins = MemoryPins())
    n.rig.run()
    assertNull(n.phone.endpoint)
    assertEquals(0, n.phone.plainBytes)
    assertEquals(TlsEnd.FAILED, n.phone.end)
    assertEquals(TlsFailure.PIN, n.phone.session.failure)
    assertEquals(TlsFailure.PIN, n.phone.failureAtEnd)
  }

  @Test
  fun aClientTheServerRefusesFinishesItsHandshakeFirstThenLearnsItWasRefused() {
    val n = NormalRig(phonePins = MemoryPins(TestKeys.attacker.spkiHash()))
    n.rig.run()
    // TLS 1.3: the watch (client) is secure before the phone has checked its certificate, so its endpoint opened and wrote a hello ...
    assertTrue(n.watch.secured)
    assertTrue(n.watch.endpoint != null)
    // ... which the phone never read, and the refusal reaches the watch as an end before any message from the phone.
    assertNull(n.phone.endpoint)
    assertEquals(0, n.phone.plainBytes)
    assertEquals(TlsEnd.REFUSED, n.watch.end)
    assertEquals(listOf(CloseReason.TLS_REFUSED), n.watch.events.closed)
  }

  @Test
  fun aClientThatLosesTheStreamAfterItsHandshakeWithNoAlertAndNoMessageIsToldItWasRefused() {
    val n = NormalRig()
    n.rig.toClient = { if (n.watch.secured) null else it }
    n.rig.run()
    assertTrue(n.watch.secured)
    n.watch.session.onTransportClosed()
    assertEquals(TlsEnd.REFUSED, n.watch.end)
    assertEquals(listOf(CloseReason.TLS_REFUSED), n.watch.events.closed)
  }

  @Test
  fun aServerThatIsNotThePinnedKeyIsRefusedByTheClientBeforeItsEndpointOpens() {
    val n = NormalRig(watchPins = MemoryPins(TestKeys.attacker.spkiHash()))
    n.rig.run()
    assertEquals(false, n.watch.secured)
    assertNull(n.watch.endpoint)
    assertEquals(TlsEnd.FAILED, n.watch.end)
    assertEquals(TlsFailure.PIN, n.watch.session.failure)
    assertEquals(0, n.watch.plainBytes)
  }

  @Test
  fun aPeerThatOffersOnlyTls12IsRefusedAndNothingReachesAnEndpoint() {
    val clock = FakeClock()
    val config = LinkConfig()
    val phonePins = MemoryPins(TestKeys.watch.spkiHash())
    val phone = Peer(TestKeys.phone, false, PinningTrustManager.pinned(phonePins), clock, config, { s, e -> PhoneEndpoint(s, clock, FakePhoneRoutes(), FakeSink(), e, config) })
    val watchTrust = PinningTrustManager.pinned(MemoryPins(TestKeys.phone.spkiHash()))
    val watch = Peer(TestKeys.watch, true, watchTrust, clock, config, { s, e -> WatchEndpoint(s, clock, FakeWatchRoutes(), FakeOutbox(), e, config) }, tls12Engine(TestKeys.watch, watchTrust, true))
    Rig(phone, watch).run()
    assertEquals(false, phone.secured)
    assertEquals(false, watch.secured)
    assertNull(phone.endpoint)
    assertNull(watch.endpoint)
    assertEquals(TlsEnd.FAILED, phone.end)
  }

  @Test
  fun aClientWithNoCertificateIsRefused() {
    val clock = FakeClock()
    val config = LinkConfig()
    val phone = Peer(TestKeys.phone, false, PinningTrustManager.pinned(MemoryPins(TestKeys.watch.spkiHash())), clock, config, { s, e -> PhoneEndpoint(s, clock, FakePhoneRoutes(), FakeSink(), e, config) })
    val trust = PinningTrustManager.pinned(MemoryPins(TestKeys.phone.spkiHash()))
    val context = javax.net.ssl.SSLContext.getInstance("TLSv1.3").apply { init(null, arrayOf(trust), null) }
    val bare = context.createSSLEngine().apply { useClientMode = true; enabledProtocols = arrayOf("TLSv1.3") }
    val watch = Peer(TestKeys.watch, true, trust, clock, config, { s, e -> WatchEndpoint(s, clock, FakeWatchRoutes(), FakeOutbox(), e, config) }, bare)
    Rig(phone, watch).run()
    assertNull(phone.endpoint)
    assertEquals(0, phone.plainBytes)
    assertEquals(TlsEnd.FAILED, phone.end)
  }

  @Test
  fun everySessionChecksThePinAgainSoNothingIsResumed() {
    val pins = MemoryPins(TestKeys.watch.spkiHash())
    val watchPins = MemoryPins(TestKeys.phone.spkiHash())
    val first = NormalRig(phonePins = pins, watchPins = watchPins)
    first.rig.run()
    assertTrue(first.phone.secured)
    pins.clear()
    val second = NormalRig(phonePins = pins, watchPins = watchPins)
    second.rig.run()
    assertEquals(false, second.phone.secured)
    assertNull(second.phone.endpoint)
  }

  @Test
  fun aStreamThatEndsWithoutCloseNotifyIsReportedAsTruncated() {
    val n = NormalRig()
    n.rig.run()
    n.phone.session.onTransportClosed()
    assertEquals(TlsEnd.TRUNCATED, n.phone.end)
    assertEquals(CloseReason.TLS_TRUNCATED, n.phone.events.closed.single())
  }

  @Test
  fun aCloseNotifyIsACleanEndAndTheEndpointSeesPeerClosed() {
    val n = NormalRig()
    n.rig.run()
    n.watch.endpoint!!.close()
    n.rig.settle()
    assertEquals(TlsEnd.CLEAN, n.phone.end)
    assertEquals(CloseReason.PEER_CLOSED, n.phone.events.closed.single())
  }

  @Test
  fun plaintextBeforeTheHandshakeIsFinishedThrows() {
    val n = NormalRig()
    assertThrows(IllegalStateException::class.java) { n.watch.session.write(byteArrayOf(1)) }
    assertEquals(0, n.watch.out.writes)
  }

  @Test
  fun aPeerThatConnectsAndSaysNothingTimesOut() {
    val n = NormalRig()
    n.phone.session.open()
    assertEquals(n.config.handshakeTimeoutMs, n.phone.session.nextDeadline())
    n.clock.now = n.config.handshakeTimeoutMs
    n.phone.session.tick()
    assertEquals(TlsEnd.TIMEOUT, n.phone.end)
    assertNull(n.phone.session.nextDeadline())
  }

  @Test
  fun aBigItemGoesOutRecordByRecordNotAsOneBuffer() {
    val n = NormalRig()
    n.phoneRoutes.queue(route(ROUTE_A, "<gpx>" + "x".repeat(200_000) + "</gpx>"))
    n.rig.run()
    assertTrue(n.phone.out.writes >= 12)
    assertEquals(setOf(ROUTE_A), n.watchRoutes.saved.keys)
  }

  @Test
  fun theHandshakeTimeoutIsOverOnceTheSessionIsSecure() {
    val n = NormalRig()
    n.rig.run()
    n.clock.now = n.config.handshakeTimeoutMs + 1
    n.phone.session.tick()
    n.watch.session.tick()
    assertNull(n.phone.end)
    assertNull(n.watch.end)
    assertNull(n.phone.session.nextDeadline())
  }

  @Test
  fun aClientThatHasHeardFromTheServerAndLosesTheStreamIsTruncatedNotRefused() {
    val n = NormalRig()
    n.rig.run()
    assertTrue(n.watch.plainBytes > 0)
    n.watch.session.onTransportClosed()
    assertEquals(TlsEnd.TRUNCATED, n.watch.end)
  }

  @Test
  fun aRefusedClientLearnsItFromTheAlertAloneWithNoEndOfStream() {
    val n = NormalRig(phonePins = MemoryPins(TestKeys.attacker.spkiHash()))
    n.rig.deliverEof = false
    n.rig.run()
    assertEquals(TlsEnd.REFUSED, n.watch.end)
  }

  @Test
  fun aClientWhoseServerFailedMidSessionAfterTalkingIsNotToldItWasRefused() {
    val n = NormalRig()
    n.rig.run()
    // a late alert (the server's engine fails on garbage) after the client heard the server
    val record = byteArrayOf(0x17, 3, 3, 0, 32) + ByteArray(32) { 9 }
    n.phone.session.onBytes(record, 0, record.size)
    n.rig.settle()
    assertEquals(TlsEnd.FAILED, n.phone.end)
    assertNotNull(n.watch.end)
    assertTrue(n.watch.end != TlsEnd.REFUSED)
  }

  @Test
  fun theEngineIsLimitedToTls13() {
    assertEquals(listOf("TLSv1.3"), Tls.engine(TestKeys.phone, PinningTrustManager.acceptingAnyKey(), false).enabledProtocols.toList())
  }

  @Test
  fun theProtocolCheckAfterTheHandshakeRefusesTls12EvenWhenTheEngineAllowedIt() {
    val clock = FakeClock()
    val config = LinkConfig()
    val phoneTrust = PinningTrustManager.pinned(MemoryPins(TestKeys.watch.spkiHash()))
    val phone = Peer(TestKeys.phone, false, phoneTrust, clock, config, { s, e -> PhoneEndpoint(s, clock, FakePhoneRoutes(), FakeSink(), e, config) }, tls12Engine(TestKeys.phone, phoneTrust, false, arrayOf("TLSv1.2", "TLSv1.3")))
    val watchTrust = PinningTrustManager.pinned(MemoryPins(TestKeys.phone.spkiHash()))
    val watch = Peer(TestKeys.watch, true, watchTrust, clock, config, { s, e -> WatchEndpoint(s, clock, FakeWatchRoutes(), FakeOutbox(), e, config) }, tls12Engine(TestKeys.watch, watchTrust, true))
    Rig(phone, watch).run()
    assertEquals(TlsFailure.PROTOCOL, phone.session.failure)
    assertEquals(false, phone.secured)
    assertNull(phone.endpoint)
  }

  @Test
  fun aWriteAfterTheSessionWasClosedThrows() {
    val n = NormalRig()
    n.rig.run()
    n.watch.session.close()
    assertThrows(java.io.IOException::class.java) { n.watch.session.write(byteArrayOf(1)) }
  }
}
