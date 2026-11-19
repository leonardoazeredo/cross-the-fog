package codes.madera.crossfog.link

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingTest {
  private fun done(p: PairRig) = p.rig.run()

  @Test
  fun theProofIsHmacSha256OfTheLabelAndBothKeyHashesKeyedWithTheCode() {
    // The expected value comes from Python's hmac module, not from this code.
    val proof = Pairing.proof(ByteArray(16) { (it + 1).toByte() }, ByteArray(32) { 0xaa.toByte() }, ByteArray(32) { 0xbb.toByte() })
    assertEquals("420c5f182eac0c0cac796e244115a8ebf54d078113a2f270a6443caf606c8f0e", Pairing.hex(proof))
  }

  @Test
  fun aRightCodePairsBothEndsAndSpendsTheCode() {
    val p = PairRig()
    done(p)
    assertArrayEquals(TestKeys.phone.spkiHash(), p.watchPins.get())
    assertArrayEquals(TestKeys.watch.spkiHash(), p.phonePins.get())
    assertEquals(CloseReason.PAIRING_COMPLETE, p.phone.events.closed.single())
  }

  @Test
  fun aReusedQrIsRefusedWithCodeUsedAndPinsStayAsTheyWere() {
    val first = PairRig()
    done(first)
    val again = PairRig(clock = first.clock, offer = first.offer, qr = first.qr, watchPins = MemoryPins(), phonePins = MemoryPins())
    done(again)
    assertEquals(PairRejection.CODE_USED, again.phoneEndpoint.rejection)
    assertNull(again.watchPins.get())
    assertNull(again.phonePins.get())
    assertEquals(CloseReason.PAIRING_REFUSED, again.phone.events.closed.single())
  }

  @Test
  fun aWrongCodeIsRefusedAndNeitherEndPins() {
    val clock = FakeClock()
    val offer = PairingOffer(clock, LinkConfig())
    val bad = QrPayload(TestKeys.watch.spkiHash(), ByteArray(16) { 7 }, "rfcomm")
    val p = PairRig(clock = clock, offer = offer, qr = bad)
    done(p)
    assertEquals(PairRejection.WRONG_CODE, p.phoneEndpoint.rejection)
    assertNull(p.watchPins.get())
    assertNull(p.phonePins.get())
  }

  @Test
  fun theFourthTryAfterThreeWrongIsRefusedEvenWithTheRightCode() {
    val clock = FakeClock()
    val offer = PairingOffer(clock, LinkConfig())
    val good = offer.payload(TestKeys.watch.spkiHash(), "rfcomm")
    val bad = QrPayload(TestKeys.watch.spkiHash(), ByteArray(16) { 7 }, "rfcomm")
    repeat(3) {
      val p = PairRig(clock = clock, offer = offer, qr = bad)
      done(p)
      assertEquals(PairRejection.WRONG_CODE, p.phoneEndpoint.rejection)
    }
    val last = PairRig(clock = clock, offer = offer, qr = good)
    done(last)
    assertEquals(PairRejection.TOO_MANY_TRIES, last.phoneEndpoint.rejection)
    assertNull(last.watchPins.get())
    assertNull(last.phonePins.get())
    assertEquals(false, offer.isOpen)
  }

  @Test
  fun theCountSurvivesConnectionsNotJustOneSession() {
    val clock = FakeClock()
    val offer = PairingOffer(clock, LinkConfig())
    val bad = QrPayload(TestKeys.watch.spkiHash(), ByteArray(16) { 9 }, "rfcomm")
    assertEquals(PairRejection.WRONG_CODE, offer.attempt("0".repeat(64), TestKeys.watch.spkiHash(), TestKeys.phone.spkiHash()))
    assertEquals(PairRejection.WRONG_CODE, offer.attempt("0".repeat(64), TestKeys.watch.spkiHash(), TestKeys.phone.spkiHash()))
    val p = PairRig(clock = clock, offer = offer, qr = bad)
    done(p)
    assertEquals(PairRejection.WRONG_CODE, p.phoneEndpoint.rejection)
    assertEquals(PairRejection.TOO_MANY_TRIES, offer.attempt("0".repeat(64), TestKeys.watch.spkiHash(), TestKeys.phone.spkiHash()))
  }

  @Test
  fun aProofMadeForOtherKeysFailsEvenWithTheRightCode() {
    val clock = FakeClock()
    val offer = PairingOffer(clock, LinkConfig())
    val qr = offer.payload(TestKeys.watch.spkiHash(), "rfcomm")
    val stolen = Pairing.hex(Pairing.proof(qr.code(), TestKeys.watch.spkiHash(), TestKeys.attacker.spkiHash()))
    assertEquals(PairRejection.WRONG_CODE, offer.attempt(stolen, TestKeys.watch.spkiHash(), TestKeys.phone.spkiHash()))
    val other = Pairing.hex(Pairing.proof(qr.code(), TestKeys.attacker.spkiHash(), TestKeys.phone.spkiHash()))
    assertEquals(PairRejection.WRONG_CODE, offer.attempt(other, TestKeys.watch.spkiHash(), TestKeys.phone.spkiHash()))
  }

  @Test
  fun theCodeExpiresOnTheInjectedClock() {
    val clock = FakeClock()
    val config = LinkConfig()
    val offer = PairingOffer(clock, config)
    val qr = offer.payload(TestKeys.watch.spkiHash(), "rfcomm")
    clock.now = config.pairingWindowMs
    val p = PairRig(clock = clock, offer = offer, qr = qr)
    done(p)
    assertEquals(PairRejection.EXPIRED, p.phoneEndpoint.rejection)
    assertNull(p.watchPins.get())
  }

  @Test
  fun aPhoneThatTrustsAnotherKeyThanTheWatchShowsNeverGetsPastTls() {
    val p = PairRig(phoneTrustExpects = TestKeys.attacker.spkiHash())
    done(p)
    assertEquals(false, p.phone.secured)
    assertEquals(0, p.watch.plainBytes)
    assertNull(p.watch.endpoint)
    assertNull(p.watchPins.get())
    assertNull(p.phonePins.get())
  }

  @Test
  fun aRelayThatTerminatesTlsWithItsOwnKeyIsRefusedByThePhoneAndStoresNothing() {
    // The phone reaches the attacker instead of the watch: the attacker shows its own key, not the one in the QR.
    val clock = FakeClock()
    val offer = PairingOffer(clock, LinkConfig())
    val qr = offer.payload(TestKeys.watch.spkiHash(), "rfcomm")
    val p = PairRig(clock = clock, offer = offer, watchId = TestKeys.attacker, qr = qr, phoneTrustExpects = TestKeys.watch.spkiHash())
    done(p)
    assertEquals(false, p.phone.secured)
    assertEquals(TlsFailure.PIN, p.phone.session.failure)
    assertNull(p.phonePins.get())
    assertNull(p.watchPins.get())
    assertTrue(offer.isOpen)
  }

  @Test
  fun aPureByteRelayStillPairsAndSeesOnlyCiphertext() {
    val p = PairRig()
    val seen = mutableListOf<ByteArray>()
    p.rig.toServer = { seen += it; it }
    p.rig.toClient = { seen += it; it }
    done(p)
    assertEquals(CloseReason.PAIRING_COMPLETE, p.phone.events.closed.single())
    val code = String(p.qr.code(), Charsets.ISO_8859_1)
    val everything = String(seen.fold(ByteArray(0)) { a, b -> a + b }, Charsets.ISO_8859_1)
    assertTrue(!everything.contains(code))
    assertTrue(!everything.contains("pairRequest"))
  }

  @Test
  fun aLeakedQrUsedFirstByAnAttackerMakesTheRealPhoneGetCodeUsed() {
    val clock = FakeClock()
    val offer = PairingOffer(clock, LinkConfig())
    val qr = offer.payload(TestKeys.watch.spkiHash(), "rfcomm")
    val attackerSide = PairRig(clock = clock, offer = offer, qr = qr, phoneId = TestKeys.attacker)
    done(attackerSide)
    assertArrayEquals(TestKeys.attacker.spkiHash(), attackerSide.watchPins.get())
    val real = PairRig(clock = clock, offer = offer, qr = qr, watchPins = MemoryPins(), phonePins = MemoryPins())
    done(real)
    assertEquals(PairRejection.CODE_USED, real.phoneEndpoint.rejection)
  }

  @Test
  fun pairingMessagesAreRefusedInANormalSession() {
    val n = NormalRig()
    n.rig.run()
    val watch = n.watch.endpoint!!
    watch.feed(PairAccepted)
    assertEquals(CloseReason.UNEXPECTED_MESSAGE, n.watch.events.closed.single())
  }

  @Test
  fun normalMessagesAreRefusedInAPairingSession() {
    val clock = FakeClock()
    val solo = Solo(clock = clock)
    val ends = RecordingEvents()
    val watch = WatchPairingEndpoint(MemoryStream(), clock, ends, LinkConfig(), PairingOffer(clock, LinkConfig()), TestKeys.watch.spkiHash(), { TestKeys.phone.spkiHash() }, MemoryPins())
    watch.open()
    watch.feed(Hello(listOf(1)), route(ROUTE_A))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), ends.closed)
    assertNotNull(solo)
  }

  @Test
  fun aLargerFrameInAPairingSessionClosesItBeforeTheBodyIsRead() {
    val clock = FakeClock()
    val ends = RecordingEvents()
    val watch = WatchPairingEndpoint(MemoryStream(), clock, ends, LinkConfig(), PairingOffer(clock, LinkConfig()), TestKeys.watch.spkiHash(), { TestKeys.phone.spkiHash() }, MemoryPins())
    watch.open()
    val prefix = byteArrayOf(0, 0, ((Pairing.MAX_FRAME_BYTES + 1) shr 8).toByte(), ((Pairing.MAX_FRAME_BYTES + 1) and 255).toByte())
    watch.onBytes(prefix, 0, 4)
    assertEquals(listOf(CloseReason.BAD_FRAME), ends.closed)
  }

  @Test
  fun theCodeAndProofNeverShowInToString() {
    val offer = PairingOffer(FakeClock(), LinkConfig())
    val qr = offer.payload(TestKeys.watch.spkiHash(), "rfcomm")
    assertEquals("QrPayload", qr.toString())
    assertEquals("PairRequest", PairRequest("a".repeat(64)).toString())
  }

  @Test
  fun theQrRoundTripsAndStaysWithinTheScreenBudget() {
    val offer = PairingOffer(FakeClock(), LinkConfig())
    for (hint in listOf("rfcomm", "tcp:192.168.100.200:65535")) {
      val qr = offer.payload(TestKeys.watch.spkiHash(), hint)
      val text = qr.encode()
      assertTrue(text.length <= QrPayload.MAX_CHARS)
      val back = QrPayload.parse(text)!!
      assertArrayEquals(qr.watchHash, back.watchHash)
      assertArrayEquals(qr.code(), back.code())
      assertEquals(hint, back.hint)
    }
  }

  @Test
  fun aMalformedQrIsRefused() {
    val offer = PairingOffer(FakeClock(), LinkConfig())
    val good = offer.payload(TestKeys.watch.spkiHash(), "rfcomm").encode()
    val parts = good.split(":")
    for (bad in listOf(
      "", good.replace("crossfog:1", "crossfog:2"), good + ":extra", good.dropLast(7) + ":", good.substring(0, 11) + "!" + good.substring(12),
      good.replace(parts[2], parts[2].dropLast(1) + "B"), good.replace("rfcomm", "RFCOMM"), "x".repeat(111),
    )) {
      assertNull(bad, QrPayload.parse(bad))
    }
  }
}
