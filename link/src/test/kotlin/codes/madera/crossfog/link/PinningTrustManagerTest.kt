package codes.madera.crossfog.link

import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLEngine
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PinningTrustManagerTest {
  private val watch = TestKeys.watch
  private val phone = TestKeys.phone
  private fun chain(i: Identity) = i.chain.toTypedArray<X509Certificate>()
  private val noEngine: SSLEngine? = null

  private fun refused(tm: PinningTrustManager, i: Identity, server: Boolean = true): CertificateException =
    assertThrows(CertificateException::class.java) {
      if (server) tm.checkServerTrusted(chain(i), "ECDSA", noEngine) else tm.checkClientTrusted(chain(i), "ECDSA", noEngine)
    }

  @Test
  fun theKeyHashAThisEndComputesForItselfIsTheOneThePeerDerivesFromTheCertificate() {
    val tm = PinningTrustManager.acceptingAnyKey()
    tm.checkClientTrusted(chain(phone), "ECDSA", noEngine)
    assertArrayEquals(phone.spkiHash(), tm.peerHash)
    assertEquals(Spki.HASH_BYTES, phone.spkiHash().size)
  }

  @Test
  fun thePinnedKeyIsAcceptedOnBothSides() {
    val tm = PinningTrustManager.pinned(MemoryPins(watch.spkiHash()))
    tm.checkServerTrusted(chain(watch), "ECDSA", noEngine)
    tm.checkClientTrusted(chain(watch), "ECDSA", noEngine)
    assertNull(tm.failure)
  }

  @Test
  fun aPinOneByteOffIsRefusedWhicheverByte() {
    for (i in listOf(0, 15, 31)) {
      val pin = watch.spkiHash().also { it[i] = (it[i].toInt() xor 1).toByte() }
      val tm = PinningTrustManager.pinned(MemoryPins(pin))
      refused(tm, watch)
      assertEquals(TlsFailure.PIN, tm.failure)
    }
  }

  @Test
  fun aValidCertificateOfAnotherKeyIsRefused() {
    val tm = PinningTrustManager.pinned(MemoryPins(watch.spkiHash()))
    refused(tm, TestKeys.attacker)
    assertEquals(TlsFailure.PIN, tm.failure)
  }

  @Test
  fun anEmptyPinStoreRefusesEveryone() {
    val tm = PinningTrustManager.pinned(MemoryPins())
    refused(tm, watch)
    refused(tm, phone, server = false)
    assertEquals(TlsFailure.PIN, tm.failure)
  }

  @Test
  fun thePinIsReadAtEachCheckSoPairingAgainAndUnpairingApplyAtOnce() {
    val pins = MemoryPins(watch.spkiHash())
    val tm = PinningTrustManager.pinned(pins)
    tm.checkServerTrusted(chain(watch), "ECDSA", noEngine)
    pins.put(phone.spkiHash())
    refused(tm, watch)
    tm.checkServerTrusted(chain(phone), "ECDSA", noEngine)
    pins.clear()
    refused(tm, phone)
  }

  @Test
  fun aChainOfTwoIsRefusedEvenWithTheLeafPinned() {
    val leaf = TestKeys.chained
    assertEquals(2, leaf.chain.size)
    val tm = PinningTrustManager.pinned(MemoryPins(leaf.spkiHash()))
    refused(tm, leaf)
    assertEquals(TlsFailure.CHAIN, tm.failure)
    assertThrows(CertificateException::class.java) { tm.checkServerTrusted(emptyArray(), "ECDSA", noEngine) }
    assertThrows(CertificateException::class.java) { tm.checkServerTrusted(null, "ECDSA", noEngine) }
  }

  @Test
  fun onlyEcOnP256IsAcceptedEvenWhenPinned() {
    for (other in listOf(TestKeys.p384, TestKeys.rsa)) {
      val tm = PinningTrustManager.pinned(MemoryPins(other.spkiHash()))
      refused(tm, other)
      assertEquals(TlsFailure.KEY, tm.failure)
      val any = PinningTrustManager.acceptingAnyKey()
      refused(any, other, server = false)
      assertNull(any.peerHash)
    }
  }

  @Test
  fun datesAreIgnoredAnExpiredCertificateWithThePinnedKeyIsAccepted() {
    val old = TestKeys.expired
    assertTrue(old.chain[0].notAfter.before(java.util.Date()))
    PinningTrustManager.pinned(MemoryPins(old.spkiHash())).checkServerTrusted(chain(old), "ECDSA", noEngine)
  }

  @Test
  fun theExpectingManagerWantsExactlyTheKeyOfTheQr() {
    PinningTrustManager.expecting(watch.spkiHash()).checkServerTrusted(chain(watch), "ECDSA", noEngine)
    refused(PinningTrustManager.expecting(watch.spkiHash()), TestKeys.attacker)
  }

  @Test
  fun theExpectingManagerKeepsItsOwnCopyOfTheHash() {
    val hash = watch.spkiHash()
    val tm = PinningTrustManager.expecting(hash)
    hash.fill(0)
    tm.checkServerTrusted(chain(watch), "ECDSA", noEngine)
  }

  @Test
  fun theAcceptAnyManagerRecordsTheKeyAndTrustsNothingElse() {
    val tm = PinningTrustManager.acceptingAnyKey()
    tm.checkClientTrusted(chain(phone), "ECDSA", noEngine)
    assertArrayEquals(phone.spkiHash(), tm.peerHash)
    refused(tm, TestKeys.chained, server = false)
    assertEquals(TlsFailure.CHAIN, tm.failure)
  }

  @Test
  fun aPinnedManagerKeepsNoPeerHash() {
    val tm = PinningTrustManager.pinned(MemoryPins(watch.spkiHash()))
    tm.checkServerTrusted(chain(watch), "ECDSA", noEngine)
    assertNull(tm.peerHash)
  }

  @Test
  fun noIssuersAreNamedAndTheSystemStoreIsNotInvolved() {
    val tm = PinningTrustManager.pinned(MemoryPins())
    assertEquals(0, tm.acceptedIssuers.size)
    // a certificate that verifies against nothing here still decides on the pin alone
    val tm2 = PinningTrustManager.pinned(MemoryPins(phone.spkiHash()))
    tm2.checkClientTrusted(chain(phone), "ECDSA", noEngine)
    assertFalse(phone.chain[0].issuerX500Principal.name.isEmpty())
  }
}
