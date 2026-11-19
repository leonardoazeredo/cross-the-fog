package codes.madera.crossfog.platform

import codes.madera.crossfog.link.Framing
import codes.madera.crossfog.link.Ids
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import javax.crypto.AEADBadTagException
import javax.crypto.SecretKey

/**
 * Encrypted files that survive while JS is not running: one `<id>.bin` per item, AES-GCM under [key]
 * with the id as AAD (so a file renamed to another id fails to authenticate). Nothing here touches
 * Android APIs, so it runs in JVM tests; the directory sync is injected for that reason.
 *
 * One instance per directory: [Synchronized] only serializes callers of the same instance.
 */
class StagingStore(
  private val dir: File,
  private val key: SecretKey,
  private val syncDir: (File) -> Unit,
  private val beforeRename: (String) -> Unit = {},
) {
  /** Durable on return: the file and its directory entry are synced, so the watch may delete its copy. */
  @Synchronized
  fun stage(id: String, bytes: ByteArray) {
    requireId(id)
    if (!dir.isDirectory) {
      if (!dir.mkdirs()) throw IOException("cannot create the staging directory")
      // The new directory's own entry lives in its parent; without this a power loss after the
      // first stage can take the whole directory, and the watch has already deleted its copy.
      syncDir(dir.parentFile!!)
    }
    val blob = KeyWrap(key, id).wrap(bytes)
    val tmp = File(dir, "$id.tmp")
    // A failure leaves the .tmp behind, as a crash would: the next stage of this id overwrites it
    // and release removes it, and list never reports it.
    FileOutputStream(tmp).use { out ->
      out.write(blob)
      out.fd.sync()
    }
    beforeRename(id)
    if (!tmp.renameTo(File(dir, "$id.bin"))) throw IOException("cannot rename the staged file")
    syncDir(dir)
  }

  @Synchronized
  fun list(): List<String> = stagedIds(dir)

  /** The same ids, least recently written first (an item staged again counts as new); ties by id. */
  @Synchronized
  fun listOldestFirst(): List<String> =
    stagedIds(dir).sortedWith(compareBy({ File(dir, "$it$BIN").lastModified() }, { it }))

  /**
   * Moves an item out of the listing without deleting it: it stays sealed under the same key and id,
   * readable through [readAside]. Setting aside an item that is gone is not an error. An item set aside
   * again under the same id replaces the earlier copy: the id names one route, and the later copy is its latest content.
   */
  @Synchronized
  fun setAside(id: String) {
    requireId(id)
    val file = File(dir, "$id$BIN")
    if (file.exists()) {
      val aside = File(dir, StoredNames.ASIDE_DIR)
      if (!aside.isDirectory && !aside.mkdirs()) throw IOException("cannot create the aside directory")
      if (!file.renameTo(File(aside, "$id$BIN"))) throw IOException("cannot move the item aside")
      syncDir(aside)
      syncDir(dir)
    }
    val tmp = File(dir, "$id.tmp")
    if (!tmp.delete() && tmp.exists()) throw IOException("cannot delete a staged file")
  }

  /** An item moved aside, or null when none is. Throws like [read] for one that cannot be opened. */
  @Synchronized
  fun readAside(id: String): ByteArray? {
    requireId(id)
    val file = File(File(dir, StoredNames.ASIDE_DIR), "$id$BIN")
    if (!file.exists()) return null
    if (file.length() > Framing.MAX_FRAME_BYTES + OVERHEAD_BYTES) throw UnreadableItemException()
    return try {
      KeyWrap(key, id).unwrap(file.readBytes())
    } catch (e: AEADBadTagException) {
      throw UnreadableItemException(e)
    }
  }

  /**
   * Null only for an absent item. An oversized or unauthenticated one throws UnreadableItemException,
   * so a caller can tell an item it may never read from one that is not there.
   */
  @Synchronized
  fun read(id: String): ByteArray? {
    requireId(id)
    val file = File(dir, "$id$BIN")
    if (!file.exists()) return null
    if (file.length() > Framing.MAX_FRAME_BYTES + OVERHEAD_BYTES) throw UnreadableItemException()
    return try {
      KeyWrap(key, id).unwrap(file.readBytes())
    } catch (e: AEADBadTagException) {
      throw UnreadableItemException(e)
    }
  }

  @Synchronized
  fun release(id: String) {
    requireId(id)
    for (name in listOf("$id$BIN", "$id.tmp")) {
      val file = File(dir, name)
      // delete() cannot tell a missing file from one it failed to remove.
      if (!file.delete() && file.exists()) throw IOException("cannot delete a staged file")
    }
  }

  private fun requireId(id: String) = require(UUID_ID.matches(id)) { "invalid staging id" }

  private companion object {
    const val BIN = ".bin"
    // IV (12) and GCM tag (16), see KeyWrap.
    const val OVERHEAD_BYTES = 28
  }
}

/** The ids of the `<id>.bin` items in `dir`, with no key: the same listing `list` returns. */
internal fun stagedIds(dir: File): List<String> =
  dir.listFiles().orEmpty()
    .map { it.name }
    .filter { it.endsWith(".bin") && UUID_ID.matches(it.removeSuffix(".bin")) }
    .map { it.removeSuffix(".bin") }
    .sorted()

/**
 * A staged item that is there but can never be read under this key: too large, tampered with, moved
 * to another id, or sealed under a staging key that was since replaced. An IOException, so
 * `readStagedActivities` counts it like a file it cannot read.
 */
class UnreadableItemException(cause: Throwable? = null) :
  IOException("the staged item cannot be read", cause)

/**
 * The id becomes a file name and arrives from watch frames and from JS. The RFC form; it matches
 * zod 4's uuid() except that the nil and max UUIDs are rejected. `link/` checks the same form, so a
 * frame it accepts is never one this store refuses, and a looser match would stage items that
 * pendingActivities then skips.
 */
internal val UUID_ID = Ids.UUID
