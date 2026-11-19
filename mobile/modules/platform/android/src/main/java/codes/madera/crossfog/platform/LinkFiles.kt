package codes.madera.crossfog.platform

import codes.madera.crossfog.link.LedgerStore
import codes.madera.crossfog.link.PinStore
import codes.madera.crossfog.link.Spki
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Replaces `dir/name` with [bytes] in one step: the new content is written and synced under a
 * temporary name, renamed over the old file, and the directory entry is synced, so a crash leaves the
 * old content or the new, never part of either.
 */
internal fun writeFileAtomically(dir: File, name: String, bytes: ByteArray, syncDir: (File) -> Unit) {
  if (!dir.isDirectory) {
    if (!dir.mkdirs()) throw IOException("cannot create the link directory")
    syncDir(dir.parentFile!!)
  }
  val tmp = File(dir, "$name.tmp")
  FileOutputStream(tmp).use { out ->
    out.write(bytes)
    out.fd.sync()
  }
  if (!tmp.renameTo(File(dir, name))) throw IOException("cannot rename the link file")
  syncDir(dir)
}

/**
 * The one peer this end trusts, as the key hash pairing stored. The hash identifies a public key and
 * is no secret, so the file is plain; a file that is not exactly one hash reads as no pin, which is
 * the safe reading (nothing is trusted).
 */
internal class FilePinStore(private val dir: File, private val syncDir: (File) -> Unit) : PinStore {
  private val file get() = File(dir, StoredNames.LINK_PIN_FILE)

  @Synchronized
  override fun get(): ByteArray? {
    if (!file.isFile) return null
    val bytes = file.readBytes()
    return if (bytes.size == Spki.HASH_BYTES) bytes else null
  }

  @Synchronized
  override fun put(pin: ByteArray) {
    require(pin.size == Spki.HASH_BYTES) { "a pin is one key hash" }
    writeFileAtomically(dir, StoredNames.LINK_PIN_FILE, pin.copyOf(), syncDir)
  }

  @Synchronized
  override fun clear() {
    // No directory means no pin was ever written, and there is nothing to sync.
    if (!dir.isDirectory) return
    if (!file.delete() && file.exists()) throw IOException("cannot delete the pin")
    syncDir(dir)
  }
}

/** The item ledger's counts, kept as the text the ledger writes (ids and counts only). */
internal class FileLedgerStore(private val dir: File, private val syncDir: (File) -> Unit) : LedgerStore {
  private val file get() = File(dir, StoredNames.LINK_LEDGER_FILE)

  @Synchronized
  override fun read(): String? = if (file.isFile) file.readText(Charsets.UTF_8) else null

  @Synchronized
  override fun write(text: String) = writeFileAtomically(dir, StoredNames.LINK_LEDGER_FILE, text.toByteArray(Charsets.UTF_8), syncDir)
}
