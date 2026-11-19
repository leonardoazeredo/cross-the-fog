package codes.madera.crossfog.link

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** The pieces of a pairing that both ends compute alike. */
object Pairing {
  const val CODE_BYTES = 16
  const val MAX_TRIES = 3

  /**
   * The largest frame a pairing session reads. The watch takes any peer there, so a frame is capped
   * at what hello and the five pairing messages need (the longest, a request, is about 110 bytes).
   */
  const val MAX_FRAME_BYTES = 512

  private val LABEL = "crossfog-pair-1".toByteArray(Charsets.US_ASCII)

  /**
   * HMAC-SHA256 keyed with the one-time [code] over a fixed label and both key hashes, so a proof made
   * for one pair of keys is useless for another. Fixed-length fields, so no two inputs share a byte string.
   */
  fun proof(code: ByteArray, watchHash: ByteArray, phoneHash: ByteArray): ByteArray {
    require(code.size == CODE_BYTES && watchHash.size == Spki.HASH_BYTES && phoneHash.size == Spki.HASH_BYTES) { "bad field size" }
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(code, "HmacSHA256"))
    mac.update(LABEL)
    mac.update(watchHash)
    mac.update(phoneHash)
    return mac.doFinal()
  }

  fun hex(bytes: ByteArray): String = buildString(bytes.size * 2) {
    for (b in bytes) {
      append("0123456789abcdef"[(b.toInt() shr 4) and 15])
      append("0123456789abcdef"[b.toInt() and 15])
    }
  }
}

/** Unpadded base64url with no non-canonical forms: what a QR needs, in a few lines that refuse any other spelling. */
internal object B64Url {
  private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

  fun encode(bytes: ByteArray): String {
    val out = StringBuilder()
    var i = 0
    while (i < bytes.size) {
      val n = minOf(3, bytes.size - i)
      var v = 0
      for (k in 0 until 3) v = (v shl 8) or (if (k < n) bytes[i + k].toInt() and 255 else 0)
      for (k in 0..n) out.append(ALPHABET[(v shr (18 - 6 * k)) and 63])
      i += n
    }
    return out.toString()
  }

  /** Null for a wrong length, a character outside the alphabet, or spare bits that are not zero. */
  fun decode(text: String, bytes: Int): ByteArray? {
    if (text.length != (bytes * 8 + 5) / 6) return null
    val out = ByteArray(bytes)
    var acc = 0
    var bits = 0
    var o = 0
    for (c in text) {
      val v = ALPHABET.indexOf(c)
      if (v < 0) return null
      acc = (acc shl 6) or v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out[o++] = ((acc shr bits) and 255).toByte()
      }
    }
    return if ((acc and ((1 shl bits) - 1)) == 0) out else null
  }
}

/**
 * What the watch shows as a QR: `crossfog:1:<watch key hash>:<code>:<hint>`, at most [MAX_CHARS]
 * characters (a QR of version 6 fits a round screen). The hint says how to reach the watch
 * (`rfcomm` or `tcp:<ipv4>:<port>`); `link/` checks the shape and the radio adapter acts on it. The code is never printed.
 */
class QrPayload(watchHash: ByteArray, code: ByteArray, val hint: String) {
  val watchHash: ByteArray = watchHash.copyOf()
  private val codeBytes: ByteArray = code.copyOf()

  init {
    require(this.watchHash.size == Spki.HASH_BYTES && codeBytes.size == Pairing.CODE_BYTES) { "bad field size" }
    require(HINT.matches(hint)) { "bad hint" }
  }

  fun code(): ByteArray = codeBytes.copyOf()

  fun encode(): String = "$PREFIX${B64Url.encode(watchHash)}:${B64Url.encode(codeBytes)}:$hint"

  override fun toString() = "QrPayload"

  companion object {
    const val MAX_CHARS = 110
    private const val PREFIX = "crossfog:1:"
    private val HINT = Regex("rfcomm|tcp:[0-9]{1,3}(\\.[0-9]{1,3}){3}:[0-9]{1,5}")

    /** Null for anything that is not exactly this format, whatever is wrong with it. */
    fun parse(text: String): QrPayload? {
      if (text.length > MAX_CHARS || !text.startsWith(PREFIX)) return null
      val parts = text.substring(PREFIX.length).split(':', limit = 3)
      if (parts.size != 3) return null
      val hash = B64Url.decode(parts[0], Spki.HASH_BYTES) ?: return null
      val code = B64Url.decode(parts[1], Pairing.CODE_BYTES) ?: return null
      if (!HINT.matches(parts[2])) return null
      return QrPayload(hash, code, parts[2])
    }
  }
}

/**
 * The watch's one-time pairing code, its tries and its window. It lives in memory only: a restart
 * loses the code and the count together. The count is across connections, so a peer cannot get
 * three tries per connection. The caller serves one pairing connection at a time.
 */
class PairingOffer(private val clock: Clock, config: LinkConfig, random: SecureRandom = SecureRandom()) {
  private var code: ByteArray? = ByteArray(Pairing.CODE_BYTES).also { random.nextBytes(it) }
  private val expiresAt = clock.nowMillis() + config.pairingWindowMs
  private var wrong = 0
  private var spent = false

  /** The QR to show; throws once the code is spent or destroyed. */
  fun payload(watchHash: ByteArray, hint: String): QrPayload = QrPayload(watchHash, checkNotNull(code) { "pairing code is gone" }, hint)

  /** Whether the code is still good for a try. */
  val isOpen: Boolean get() = code != null && !spent && clock.nowMillis() < expiresAt

  /** Null when [proofHex] is right (the code is then spent), else why not. A wrong try counts; the third destroys the code. */
  fun attempt(proofHex: String, watchHash: ByteArray, phoneHash: ByteArray): PairRejection? {
    if (spent) return PairRejection.CODE_USED
    val c = code ?: return PairRejection.TOO_MANY_TRIES
    if (clock.nowMillis() >= expiresAt) {
      destroy()
      return PairRejection.EXPIRED
    }
    val expected = Pairing.hex(Pairing.proof(c, watchHash, phoneHash)).toByteArray(Charsets.US_ASCII)
    if (MessageDigest.isEqual(expected, proofHex.toByteArray(Charsets.US_ASCII))) {
      spent = true
      destroy()
      return null
    }
    if (++wrong >= Pairing.MAX_TRIES) destroy()
    return PairRejection.WRONG_CODE
  }

  private fun destroy() {
    code?.fill(0)
    code = null
  }
}

/**
 * The watch's end of a pairing session (the watch is the TLS server). [peerKey] is the hash of the
 * key the peer showed in this handshake. The old phone pin is replaced at one point only: when the
 * phone's confirmation arrives, after the code proof matched. Until then the store is untouched.
 */
class WatchPairingEndpoint(
  stream: ByteStream,
  clock: Clock,
  events: LinkEvents,
  config: LinkConfig,
  private val offer: PairingOffer,
  private val ownKey: ByteArray,
  private val peerKey: () -> ByteArray?,
  private val pins: PinStore,
) : Endpoint(stream, clock, events, config, Pairing.MAX_FRAME_BYTES) {
  private var phoneKey: ByteArray? = null
  private var accepted = false

  override fun pump() = Unit

  override fun onMessage(message: Message) {
    when {
      !accepted && message is PairRequest -> onRequest(message)
      accepted && message is PairConfirm -> onConfirm()
      else -> close(CloseReason.UNEXPECTED_MESSAGE)
    }
  }

  private fun onRequest(request: PairRequest) {
    val phone = peerKey() ?: return close(CloseReason.TLS_FAILED)
    val rejection = offer.attempt(request.proof, ownKey, phone)
    if (rejection != null) {
      send(PairRejected(rejection))
      return close(CloseReason.PAIRING_REFUSED)
    }
    phoneKey = phone
    if (!send(PairAccepted)) return
    accepted = true
    armConfirm()
  }

  private fun onConfirm() {
    disarmConfirm()
    try {
      pins.put(checkNotNull(phoneKey))
    } catch (e: Exception) {
      return close(CloseReason.STORE_FAILED)
    }
    if (send(PairDone)) close(CloseReason.PAIRING_COMPLETE)
  }
}

/**
 * The phone's end of a pairing session (the phone is the TLS client). The watch's key hash comes
 * from the QR, and the TLS layer has already refused any other key. The new pin is held in memory
 * and written only when the watch says done, so a pairing that fails or drops leaves the old pin as it was.
 */
class PhonePairingEndpoint(
  stream: ByteStream,
  clock: Clock,
  events: LinkEvents,
  config: LinkConfig,
  private val qr: QrPayload,
  private val ownKey: ByteArray,
  private val pins: PinStore,
) : Endpoint(stream, clock, events, config, Pairing.MAX_FRAME_BYTES) {
  private enum class Step { IDLE, AWAIT_ACCEPT, AWAIT_DONE }

  private var step = Step.IDLE

  /** Why the watch refused, when it did. */
  var rejection: PairRejection? = null
    private set

  override fun pump() {
    if (step != Step.IDLE) return
    val code = qr.code()
    val proof = try {
      Pairing.proof(code, qr.watchHash, ownKey)
    } finally {
      code.fill(0)
    }
    step = Step.AWAIT_ACCEPT
    if (send(PairRequest(Pairing.hex(proof)))) armConfirm()
  }

  override fun onMessage(message: Message) {
    when {
      step == Step.AWAIT_ACCEPT && message is PairAccepted -> {
        step = Step.AWAIT_DONE
        if (send(PairConfirm)) armConfirm()
      }
      step == Step.AWAIT_ACCEPT && message is PairRejected -> {
        rejection = message.reason
        close(CloseReason.PAIRING_REFUSED)
      }
      step == Step.AWAIT_DONE && message is PairDone -> {
        try {
          pins.put(qr.watchHash)
        } catch (e: Exception) {
          return close(CloseReason.STORE_FAILED)
        }
        close(CloseReason.PAIRING_COMPLETE)
      }
      else -> close(CloseReason.UNEXPECTED_MESSAGE)
    }
  }
}
