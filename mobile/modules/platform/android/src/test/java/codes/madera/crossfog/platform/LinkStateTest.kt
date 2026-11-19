package codes.madera.crossfog.platform

import codes.madera.crossfog.link.PinStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkStateTest {
  private class Pins(var pin: ByteArray? = null) : PinStore {
    override fun get() = pin?.copyOf()

    override fun put(pin: ByteArray) {
      this.pin = pin.copyOf()
    }

    override fun clear() {
      pin = null
    }
  }

  private val hash = ByteArray(32) { it.toByte() }
  private val code = ByteArray(16) { (it + 100).toByte() }
  private val b64 = java.util.Base64.getUrlEncoder().withoutPadding()
  private val qr = "crossfog:1:${b64.encodeToString(hash)}:${b64.encodeToString(code)}:rfcomm"

  @Test
  fun withoutAPinTheLinkIsNotPairedAndNotReachable() {
    val status = LinkState(Pins()).status()
    assertFalse(status.paired)
    assertFalse(status.reachable)
  }

  @Test
  fun withAPinTheLinkIsPairedButStillNotReachableWithoutATransport() {
    val status = LinkState(Pins(hash)).status()
    assertTrue(status.paired)
    assertFalse(status.reachable)
  }

  @Test
  fun aPinWhoseIdentityIsGoneIsNotPairedAndIsCleared() {
    val pins = Pins(hash)
    val state = LinkState(pins, identityPresent = { false })
    assertFalse(state.status().paired)
    assertNull(pins.pin)
  }

  @Test
  fun aPinWithItsIdentityIsPaired() {
    assertTrue(LinkState(Pins(hash), identityPresent = { true }).status().paired)
  }

  @Test
  fun anIdentityThatCannotBeCheckedKeepsThePinButReportsNotPaired() {
    val pins = Pins(hash)
    val state = LinkState(pins, identityPresent = { throw java.security.KeyStoreException("busy") })
    assertFalse(state.status().paired)
    assertTrue(pins.pin != null)
  }

  @Test
  fun pairingWithoutATransportIsRefusedWithNoTransportAndPairsNothing() {
    val pins = Pins()
    val e = assertThrows(PairException::class.java) { LinkState(pins).pair(qr) }
    assertEquals(PairFailureKind.NO_TRANSPORT, e.kind)
    assertEquals("no transport", e.message)
    assertNull(pins.pin)
  }

  @Test
  fun aMalformedQrIsRefusedAsInvalidBeforeAnythingElse() {
    for (bad in listOf("", "garbage", "crossfog:2:x:y:rfcomm", qr + ":extra", qr.replace("rfcomm", "bluetooth"))) {
      val e = assertThrows(bad, PairException::class.java) { LinkState(Pins()).pair(bad) }
      assertEquals(bad, PairFailureKind.INVALID_QR, e.kind)
    }
  }

  @Test
  fun theQrIsNeverRepeatedInTheErrorOrItsMessage() {
    val e = assertThrows(PairException::class.java) { LinkState(Pins()).pair(qr) }
    assertFalse(e.message!!.contains(qr))
    val bad = assertThrows(PairException::class.java) { LinkState(Pins()).pair("secret-looking-text") }
    assertFalse(bad.message!!.contains("secret"))
  }

  @Test
  fun aTransportIsHandedTheParsedPayloadAndItsFailureSurfaces() {
    var seen: String? = null
    val state = LinkState(Pins()) { payload -> seen = payload.hint }
    state.pair(qr)
    assertEquals("rfcomm", seen)
  }

  @Test
  fun unpairingRemovesThePinAndIsIdempotent() {
    val pins = Pins(hash)
    val state = LinkState(pins)
    state.unpair()
    assertNull(pins.pin)
    state.unpair()
    assertFalse(state.status().paired)
  }

  @Test
  fun aPinStoreThatCannotBeReadMeansNotPaired() {
    val broken = object : PinStore {
      override fun get(): ByteArray? = throw java.io.IOException("gone")

      override fun put(pin: ByteArray) = Unit

      override fun clear() = Unit
    }
    assertFalse(LinkState(broken).status().paired)
  }

  @Test
  fun failuresReachJsWithFixedCodesAndMessages() {
    val none = pairCallFailure(PairException(PairFailureKind.NO_TRANSPORT))!!
    assertEquals("ERR_NO_TRANSPORT", none.code)
    assertEquals("no transport", none.message)
    val invalid = pairCallFailure(PairException(PairFailureKind.INVALID_QR))!!
    assertEquals("ERR_INVALID_QR", invalid.code)
    assertNull(pairCallFailure(IllegalStateException("bug")))
  }
}
