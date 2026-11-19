package codes.madera.crossfog.platform

import androidx.test.ext.junit.runners.AndroidJUnit4
import codes.madera.crossfog.link.ByteStream
import codes.madera.crossfog.link.Clock
import codes.madera.crossfog.link.CloseInfo
import codes.madera.crossfog.link.CloseReason
import codes.madera.crossfog.link.Identity
import codes.madera.crossfog.link.LinkConfig
import codes.madera.crossfog.link.LinkEvents
import codes.madera.crossfog.link.PairingOffer
import codes.madera.crossfog.link.PinStore
import codes.madera.crossfog.link.SecureSession
import codes.madera.crossfog.link.Sessions
import codes.madera.crossfog.link.Spki
import codes.madera.crossfog.link.spkiHash
import java.security.MessageDigest
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The link identity in the real Keystore. Both ends of the loopback use Keystore keys under test
 * aliases, so what is proved is that a TLS 1.3 handshake signs through the provider, which the JVM's
 * software keys cannot show.
 */
@RunWith(AndroidJUnit4::class)
class KeystoreIdentityTest {
  private val phoneAlias = "crossfog.link.test.phone"
  private val watchAlias = "crossfog.link.test.watch"

  @After
  fun cleanUp() {
    KeystoreIdentity.delete(phoneAlias)
    KeystoreIdentity.delete(watchAlias)
  }

  private class Pins : PinStore {
    var pin: ByteArray? = null

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

    override fun ready() = Unit

    override fun closed(reason: CloseReason, itemId: String?) = Unit

    override fun closedWith(info: CloseInfo) {
      ends += info
    }
  }

  private val clock = object : Clock {
    override fun nowMillis() = 0L
  }

  private fun run(watch: SecureSession, watchOut: Pipe, phone: SecureSession, phoneOut: Pipe) {
    watch.open()
    phone.open()
    repeat(200) {
      var moved = false
      while (phoneOut.queue.isNotEmpty()) {
        moved = true
        phoneOut.queue.removeFirst().let { watch.onBytes(it, 0, it.size) }
      }
      while (watchOut.queue.isNotEmpty()) {
        moved = true
        watchOut.queue.removeFirst().let { phone.onBytes(it, 0, it.size) }
      }
      if (!moved) return
    }
    error("did not settle")
  }

  @Test
  fun theSameKeyComesBackOnASecondLoadAndHasNoExtractableBytes() {
    val first = KeystoreIdentity.loadOrCreate(phoneAlias)
    val second = KeystoreIdentity.loadOrCreate(phoneAlias)
    assertArrayEquals(first.spkiHash(), second.spkiHash())
    assertNull(first.key.encoded)
  }

  @Test
  fun theKeyIsP256AndItsHashIsTheSha256OfTheCertificatesPublicKey() {
    val id = KeystoreIdentity.loadOrCreate(phoneAlias)
    assertTrue(Spki.isP256(id.chain.first().publicKey))
    assertArrayEquals(MessageDigest.getInstance("SHA-256").digest(id.chain.first().publicKey.encoded), id.spkiHash())
  }

  @Test
  fun deletingTheIdentityMakesTheNextLoadANewKey() {
    val first = KeystoreIdentity.loadOrCreate(phoneAlias).spkiHash()
    KeystoreIdentity.delete(phoneAlias)
    assertFalse(first.contentEquals(KeystoreIdentity.loadOrCreate(phoneAlias).spkiHash()))
  }

  @Test
  fun aPairingHandshakeSignsThroughTheKeystoreAndBothPinsAreCommitted() {
    val phone: Identity = KeystoreIdentity.loadOrCreate(phoneAlias)
    val watch: Identity = KeystoreIdentity.loadOrCreate(watchAlias)
    val config = LinkConfig()
    val offer = PairingOffer(clock, config)
    val watchPins = Pins()
    val phonePins = Pins()
    val qr = offer.payload(watch.spkiHash(), "rfcomm")
    val watchOut = Pipe()
    val phoneOut = Pipe()
    val watchEvents = Events()
    val phoneEvents = Events()
    val watchSession = Sessions.pairingWatch(watchOut, watch, offer, watchPins, clock, config, watchEvents)
    val phoneSession = Sessions.pairingPhone(phoneOut, phone, qr, phonePins, clock, config, phoneEvents)
    run(watchSession, watchOut, phoneSession, phoneOut)
    assertEquals(listOf(CloseReason.PAIRING_COMPLETE), watchEvents.ends.map { it.reason })
    assertEquals(listOf(CloseReason.PAIRING_COMPLETE), phoneEvents.ends.map { it.reason })
    assertArrayEquals(phone.spkiHash(), watchPins.pin)
    assertArrayEquals(watch.spkiHash(), phonePins.pin)
  }

  @Test
  fun aPairingWithAnotherWatchesCodeIsRefusedAndPinsNothing() {
    val phone: Identity = KeystoreIdentity.loadOrCreate(phoneAlias)
    val watch: Identity = KeystoreIdentity.loadOrCreate(watchAlias)
    val config = LinkConfig()
    val offer = PairingOffer(clock, config)
    val watchPins = Pins()
    val phonePins = Pins()
    // the QR names a different key than the one the watch presents
    val qr = offer.payload(ByteArray(32) { 5 }, "rfcomm")
    val watchOut = Pipe()
    val phoneOut = Pipe()
    val watchEvents = Events()
    val phoneEvents = Events()
    val watchSession = Sessions.pairingWatch(watchOut, watch, offer, watchPins, clock, config, watchEvents)
    val phoneSession = Sessions.pairingPhone(phoneOut, phone, qr, phonePins, clock, config, phoneEvents)
    run(watchSession, watchOut, phoneSession, phoneOut)
    assertNull(watchPins.pin)
    assertNull(phonePins.pin)
    // the phone refused the key before any signing was wasted on a pairing that could not finish
    assertTrue(phoneEvents.ends.none { it.reason == CloseReason.PAIRING_COMPLETE })
    assertTrue(watchEvents.ends.none { it.reason == CloseReason.PAIRING_COMPLETE })
    assertEquals(1, phoneEvents.ends.size)
  }
}
