package codes.madera.crossfog.link

import java.net.Socket
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedTrustManager

/** Why a certificate was refused; a kind only, never the certificate. */
enum class TlsFailure { PIN, KEY, CHAIN, PROTOCOL, OTHER }

/**
 * The only trust manager the link uses, and the only thing that decides whether a peer is trusted:
 * it never consults the system's trust store, dates, names, issuers, OCSP or CRLs. A certificate is
 * accepted when it is the one certificate presented, holds an EC P-256 key, and its key hash
 * ([Spki.hash]) is the one this manager was built to expect, compared in constant time. Dates are
 * ignored on purpose: the certificate is only a container for the key, and a watch with a wrong clock
 * must not lose its link; a key is retired by pairing again.
 *
 * It extends [X509ExtendedTrustManager] so JSSE does not wrap it with checks of its own.
 */
class PinningTrustManager private constructor(
  private val expected: () -> ByteArray?,
  private val recordsAnyKey: Boolean,
) : X509ExtendedTrustManager() {
  @Volatile
  var failure: TlsFailure? = null
    private set

  /** The key hash of the last peer certificate this manager accepted; only a manager that accepts any key keeps it. */
  @Volatile
  var peerHash: ByteArray? = null
    private set

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = check(chain)

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = check(chain)

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) = check(chain)

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) = check(chain)

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) = check(chain)

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) = check(chain)

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

  private fun check(chain: Array<out X509Certificate>?) {
    if (chain == null || chain.size != 1) throw refuse(TlsFailure.CHAIN)
    val leaf = chain[0]
    if (!Spki.isP256(leaf.publicKey)) throw refuse(TlsFailure.KEY)
    val hash = Spki.hash(leaf)
    if (recordsAnyKey) {
      peerHash = hash
      return
    }
    val pin = expected() ?: throw refuse(TlsFailure.PIN)
    if (!MessageDigest.isEqual(hash, pin)) throw refuse(TlsFailure.PIN)
  }

  private fun refuse(kind: TlsFailure): CertificateException {
    failure = kind
    return CertificateException("peer certificate refused")
  }

  companion object {
    /** A normal session: the peer must be the one the [pins] hold, read at each handshake so unpairing and re-pairing apply to the next one. */
    fun pinned(pins: PinStore) = PinningTrustManager({ pins.get() }, recordsAnyKey = false)

    /** The phone in a pairing session: the watch's key must be the one the QR carried. */
    fun expecting(hash: ByteArray): PinningTrustManager {
      val copy = hash.copyOf()
      return PinningTrustManager({ copy }, recordsAnyKey = false)
    }

    /**
     * The watch in a pairing session: it has no pin for the phone, so it takes any P-256 key and
     * records its hash. Nothing is trusted from this: the session accepts only pairing messages,
     * and the key is pinned only after the code proof (made over both key hashes) has matched.
     */
    fun acceptingAnyKey() = PinningTrustManager({ null }, recordsAnyKey = true)
  }
}
