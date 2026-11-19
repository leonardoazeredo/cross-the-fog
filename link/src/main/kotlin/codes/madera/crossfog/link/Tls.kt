package codes.madera.crossfog.link

import java.net.Socket
import java.security.Principal
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedKeyManager

/** TLS 1.3 engines for the link: one fresh context per engine, so no session cache can span sessions. */
object Tls {
  const val PROTOCOL = "TLSv1.3"

  /**
   * An engine that speaks TLS 1.3 only and trusts only what [trust] accepts. A server asks for a
   * client certificate and refuses a handshake without one. No hostname or SNI is set: the key
   * is the identity. The cipher suite list is left to the platform, because Conscrypt ignores a list
   * for TLS 1.3 and a rule only some providers enforce would mislead.
   */
  fun engine(identity: Identity, trust: PinningTrustManager, client: Boolean): SSLEngine {
    val context = SSLContext.getInstance(PROTOCOL)
    context.init(arrayOf(IdentityKeys(identity)), arrayOf(trust), SecureRandom())
    val engine = context.createSSLEngine()
    engine.useClientMode = client
    engine.enabledProtocols = arrayOf(PROTOCOL)
    if (!client) engine.needClientAuth = true
    return engine
  }

  /** Hands the TLS engine this end's one certificate and key, whatever the peer asks for. */
  private class IdentityKeys(private val identity: Identity) : X509ExtendedKeyManager() {
    private val alias = "link"

    override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?) = arrayOf(alias)

    override fun chooseClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?) = alias

    override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?) = arrayOf(alias)

    override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: Socket?) = alias

    override fun chooseEngineClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, engine: SSLEngine?) = alias

    override fun chooseEngineServerAlias(keyType: String?, issuers: Array<out Principal>?, engine: SSLEngine?) = alias

    override fun getCertificateChain(alias: String?): Array<X509Certificate> = identity.chain.toTypedArray()

    override fun getPrivateKey(alias: String?): PrivateKey = identity.key
  }
}
