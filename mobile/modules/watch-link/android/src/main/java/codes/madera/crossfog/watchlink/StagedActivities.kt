package codes.madera.crossfog.watchlink

import android.security.keystore.KeyPermanentlyInvalidatedException
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.UnrecoverableKeyException

/**
 * What the staging store holds: the walks that read back whole, and how many items did not
 * (they fail to authenticate, as every item sealed before a lost staging alias does, or do not
 * parse or match their file name). Those stay on disk: each is the only copy the watch gave up.
 */
internal class StagedActivities(val readable: List<ActivityOffer>, val unreadable: Int)

/**
 * An unusable staging entry (`UnrecoverableKeyException`, `KeyPermanentlyInvalidatedException`) counts
 * every staged file as unreadable and keeps the files; any other Keystore failure is not caught, so it
 * propagates to the caller instead of counting every item.
 */
internal fun readStagedActivities(store: StagingStore): StagedActivities =
  readStaged(store.list(), store::read)

/**
 * As above, for a caller whose store needs the staging key: `open` is where the Keystore read of that
 * key throws, and a key that cannot be used counts the files in `dir`. Nothing here mints a new entry
 * over the unusable one, which would make every staged file unreadable for good.
 */
internal fun readStagedActivities(dir: File, open: () -> StagingStore): StagedActivities {
  val store = try {
    open()
  } catch (e: GeneralSecurityException) {
    if (!isUnusableKey(e)) throw e
    return StagedActivities(emptyList(), stagedIds(dir).size)
  }
  return readStagedActivities(store)
}

internal fun readStaged(ids: List<String>, read: (String) -> ByteArray?): StagedActivities {
  val readable = mutableListOf<ActivityOffer>()
  var unreadable = 0
  for (id in ids) {
    val item = try {
      read(id)?.let { Frames.parseActivityOffer(it) }?.takeIf { it.activityId == id }
    } catch (e: FrameException) {
      null
    } catch (e: IOException) {
      null
    } catch (e: GeneralSecurityException) {
      // The key is first used here, so an invalidated one shows mid-listing; items read before it do
      // not stay readable in the count, the whole set is reported the same way.
      if (!isUnusableKey(e)) throw e
      return StagedActivities(emptyList(), ids.size)
    }
    if (item == null) unreadable++ else readable += item
  }
  return StagedActivities(readable, unreadable)
}

private fun isUnusableKey(e: GeneralSecurityException) =
  e is UnrecoverableKeyException || e is KeyPermanentlyInvalidatedException
