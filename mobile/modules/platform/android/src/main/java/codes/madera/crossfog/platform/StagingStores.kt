package codes.madera.crossfog.platform

import java.io.File
import javax.crypto.SecretKey

/**
 * One [StagingStore] per directory for the whole process. A store serializes only the callers of its
 * own instance, so the module's functions and the link's sink, which write the same directory, must
 * share it. The key is asked for only when a directory's store is first made, and a failure to get it
 * leaves nothing behind, so the next call asks again.
 */
class StagingStores {
  private val stores = HashMap<String, StagingStore>()

  @Synchronized
  fun forDir(dir: File, key: () -> SecretKey, syncDir: (File) -> Unit): StagingStore {
    val name = dir.canonicalPath
    return stores[name] ?: StagingStore(dir, key(), syncDir).also { stores[name] = it }
  }
}

/** The holder the module and any later service in this process both use; a second holder would defeat it. */
internal val processStagingStores = StagingStores()
