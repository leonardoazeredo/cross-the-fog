package codes.madera.crossfog.link

import java.io.File
import java.nio.file.Files
import java.security.KeyStore
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit

class KeytoolIdentity(override val chain: List<X509Certificate>, override val key: PrivateKey) : Identity

/** A pin store in memory, for tests. */
class MemoryPins(initial: ByteArray? = null) : PinStore {
  private var pin: ByteArray? = initial?.copyOf()
  var puts = 0

  override fun get(): ByteArray? = pin?.copyOf()

  override fun put(pin: ByteArray) {
    puts++
    this.pin = pin.copyOf()
  }

  override fun clear() {
    pin = null
  }
}

/**
 * Keys made by the JDK's own `keytool` in a temp directory at test time, so no key material is
 * committed. Each is made once per test run.
 */
object TestKeys {
  private const val PASS = "changeit"
  private val dir: File = Files.createTempDirectory("link-keys").toFile().also { d ->
    Runtime.getRuntime().addShutdownHook(Thread { d.deleteRecursively() })
  }
  private val keytool = File(System.getProperty("java.home"), "bin/keytool").path

  val phone: Identity by lazy { make("phone") }
  val watch: Identity by lazy { make("watch") }
  val attacker: Identity by lazy { make("attacker") }
  val p384: Identity by lazy { make("p384", "-keyalg", "EC", "-keysize", "384") }
  val rsa: Identity by lazy { make("rsa", "-keyalg", "RSA", "-keysize", "2048") }
  val expired: Identity by lazy { make("expired", "-startdate", "2000/01/01 00:00:00", "-validity", "1") }

  /** A P-256 leaf signed by a CA, with the CA after it in the chain: two certificates. */
  val chained: Identity by lazy {
    val ca = File(dir, "ca.p12")
    run("-genkeypair", "-alias", "ca", "-keyalg", "EC", "-keysize", "256", "-dname", "CN=ca", "-validity", "36500", "-ext", "bc:c", "-keystore", ca.path, "-storetype", "PKCS12", "-storepass", PASS, "-keypass", PASS)
    val store = File(dir, "chained.p12")
    run("-genkeypair", "-alias", "leaf", "-keyalg", "EC", "-keysize", "256", "-dname", "CN=leaf", "-validity", "36500", "-keystore", store.path, "-storetype", "PKCS12", "-storepass", PASS, "-keypass", PASS)
    val csr = File(dir, "leaf.csr")
    val signed = File(dir, "leaf.cer")
    val caCer = File(dir, "ca.cer")
    run("-certreq", "-alias", "leaf", "-file", csr.path, "-keystore", store.path, "-storepass", PASS)
    run("-gencert", "-alias", "ca", "-infile", csr.path, "-outfile", signed.path, "-validity", "36500", "-keystore", ca.path, "-storepass", PASS)
    run("-exportcert", "-alias", "ca", "-file", caCer.path, "-keystore", ca.path, "-storepass", PASS)
    run("-importcert", "-alias", "ca", "-file", caCer.path, "-noprompt", "-keystore", store.path, "-storepass", PASS)
    run("-importcert", "-alias", "leaf", "-file", signed.path, "-keystore", store.path, "-storepass", PASS)
    load(store, "leaf")
  }

  private fun make(name: String, vararg options: String): Identity {
    val store = File(dir, "$name.p12")
    val args = mutableListOf("-genkeypair", "-alias", name, "-dname", "CN=$name", "-keystore", store.path, "-storetype", "PKCS12", "-storepass", PASS, "-keypass", PASS)
    if ("-keyalg" !in options) args += listOf("-keyalg", "EC", "-keysize", "256")
    if ("-validity" !in options) args += listOf("-validity", "36500")
    args += options
    run(*args.toTypedArray())
    return load(store, name)
  }

  private fun load(store: File, alias: String): Identity {
    val ks = KeyStore.getInstance("PKCS12")
    store.inputStream().use { ks.load(it, PASS.toCharArray()) }
    val chain = ks.getCertificateChain(alias).map { it as X509Certificate }
    return KeytoolIdentity(chain, ks.getKey(alias, PASS.toCharArray()) as PrivateKey)
  }

  private fun run(vararg args: String) {
    val p = ProcessBuilder(listOf(keytool) + args).redirectErrorStream(true).start()
    val out = p.inputStream.bufferedReader().readText()
    check(p.waitFor(60, TimeUnit.SECONDS) && p.exitValue() == 0) { "keytool failed: $out" }
  }
}
