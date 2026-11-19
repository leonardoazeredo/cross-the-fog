package codes.madera.crossfog.link

import java.security.AlgorithmParameters
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.cert.X509Certificate
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec

/**
 * This end's TLS identity: a self-signed certificate holding an EC P-256 key, and the private key.
 * [key] may be non-extractable (an Android Keystore key): this module only hands it to the TLS
 * engine, which signs with it, so nothing here needs its bytes.
 */
interface Identity {
  val chain: List<X509Certificate>
  val key: PrivateKey
}

/** The key of the one peer this end trusts, as the SHA-256 of its SPKI ([Spki.hash]); at most one. Reads are synchronous. */
interface PinStore {
  fun get(): ByteArray?

  /** Replaces the pin in one step: a failure leaves the old pin in place. */
  fun put(pin: ByteArray)

  fun clear()
}

/** The identity of a key: the SHA-256 of the SubjectPublicKeyInfo DER of the certificate holding it. */
object Spki {
  const val HASH_BYTES = 32

  fun hash(cert: X509Certificate): ByteArray = MessageDigest.getInstance("SHA-256").digest(cert.publicKey.encoded)

  /** Only EC on P-256 is accepted, whoever presents it. */
  fun isP256(key: PublicKey): Boolean {
    val ec = key as? ECPublicKey ?: return false
    val ref = p256
    val p = ec.params
    return p.curve == ref.curve && p.generator == ref.generator && p.order == ref.order && p.cofactor == ref.cofactor
  }

  private val p256: ECParameterSpec by lazy {
    AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }.getParameterSpec(ECParameterSpec::class.java)
  }
}

/** The hash this end computes for itself; its peer derives the same from the certificate it sees. */
fun Identity.spkiHash(): ByteArray = Spki.hash(chain.first())
