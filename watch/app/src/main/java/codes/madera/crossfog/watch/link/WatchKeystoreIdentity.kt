package codes.madera.crossfog.watch.link

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import codes.madera.crossfog.link.Identity
import codes.madera.crossfog.link.Spki
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import javax.security.auth.x500.X500Principal

/**
 * This watch's TLS identity: an EC P-256 key generated inside the Android Keystore, with the
 * self-signed certificate the Keystore makes for it. The private key never leaves the Keystore (it
 * signs there), so nothing here can read, copy or log it. TLS 1.3 signs with SHA-256 over the
 * handshake, and the provider needs both digests listed to sign through the TLS engine.
 */
internal class WatchKeystoreIdentity private constructor(
    override val chain: List<X509Certificate>,
    override val key: PrivateKey,
) : Identity {
    companion object {
        private const val PROVIDER = "AndroidKeyStore"

        fun exists(alias: String = WatchLinkNames.IDENTITY_ALIAS): Boolean = keyStore().containsAlias(alias)

        /** The identity under [alias], made on first use; a second call returns the same key. */
        fun loadOrCreate(alias: String = WatchLinkNames.IDENTITY_ALIAS): Identity {
            val store = keyStore()
            if (!store.containsAlias(alias)) generate(alias)
            val chain =
                store.getCertificateChain(alias)?.map { it as X509Certificate }
                    ?: throw IllegalStateException("the link identity has no certificate")
            val key = store.getKey(alias, null) as? PrivateKey ?: throw IllegalStateException("the link identity has no key")
            check(Spki.isP256(chain.first().publicKey)) { "the link identity is not P-256" }
            return WatchKeystoreIdentity(chain, key)
        }

        /** Removes an identity, so a pairing made with it can no longer be used. Absent is not an error. */
        fun delete(alias: String = WatchLinkNames.IDENTITY_ALIAS) {
            val store = keyStore()
            if (store.containsAlias(alias)) store.deleteEntry(alias)
        }

        private fun generate(alias: String) {
            val spec =
                KeyGenParameterSpec
                    .Builder(alias, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_NONE)
                    .setCertificateSubject(X500Principal("CN=crossfog-link"))
                    .build()
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER).apply { initialize(spec) }.generateKeyPair()
        }

        private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
    }
}
