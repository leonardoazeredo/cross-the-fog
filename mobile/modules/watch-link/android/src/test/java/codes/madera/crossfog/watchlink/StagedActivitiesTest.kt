package codes.madera.crossfog.watchlink

import android.security.keystore.KeyPermanentlyInvalidatedException
import java.io.File
import java.security.InvalidKeyException
import java.security.UnrecoverableKeyException
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class StagedActivitiesTest {
  @get:Rule val tmp = TemporaryFolder()

  private val sealing = SecretKeySpec(ByteArray(32) { 7 }, "AES")
  private val other = SecretKeySpec(ByteArray(32) { 9 }, "AES")
  private val a = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
  private val b = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0002"
  private val dir get() = File(tmp.root, "staging")

  private fun store(key: SecretKeySpec = sealing) = StagingStore(dir, key, {})

  private fun offer(id: String) =
    """{"activityId":"$id","encoderVersion":"1","gpx":"<gpx/>"}""".toByteArray()

  @Test
  fun readableOffersAreListedAndNothingIsUnreadable() {
    store().stage(a, offer(a))
    val staged = readStagedActivities(store())
    assertEquals(listOf(a), staged.readable.map { it.activityId })
    assertEquals(0, staged.unreadable)
  }

  // Items staged by an older build carry a travelMode; they must still be listed, not counted lost.
  @Test
  fun anItemStagedWithATravelModeIsStillListed() {
    store().stage(a, """{"activityId":"$a","travelMode":"walk","encoderVersion":"1","gpx":"<gpx/>"}""".toByteArray())
    val staged = readStagedActivities(store())
    assertEquals(listOf(a), staged.readable.map { it.activityId })
    assertEquals(0, staged.unreadable)
  }

  // A lost staging alias means a new key: what was sealed under the old one must be counted, not
  // vanish, and stay on disk.
  @Test
  fun itemsSealedUnderALostKeyAreCountedAndKept() {
    store().stage(a, offer(a))
    store().stage(b, offer(b))
    val staged = readStagedActivities(store(other))
    assertEquals(emptyList<ActivityOffer>(), staged.readable)
    assertEquals(2, staged.unreadable)
    assertTrue(File(dir, "$a.bin").exists())
    assertTrue(File(dir, "$b.bin").exists())
  }

  @Test
  fun anItemThatDoesNotParseOrMatchItsNameIsCounted() {
    store().stage(a, "not json".toByteArray())
    store().stage(b, offer(a))
    val staged = readStagedActivities(store())
    assertEquals(emptyList<ActivityOffer>(), staged.readable)
    assertEquals(2, staged.unreadable)
  }

  @Test
  fun oneUnreadableItemDoesNotHideTheOthers() {
    store(other).stage(a, offer(a))
    store().stage(b, offer(b))
    val staged = readStagedActivities(store())
    assertEquals(listOf(b), staged.readable.map { it.activityId })
    assertEquals(1, staged.unreadable)
  }

  // Counting would tell the page every walk is lost when only the Keystore failed for now.
  @Test
  fun aFailureOfTheSealingEntryIsRethrownNotCounted() {
    store().stage(a, offer(a))
    assertThrows(InvalidKeyException::class.java) {
      readStagedActivities(store(SecretKeySpec(ByteArray(5), "AES")))
    }
  }

  // The owner's call for an unusable staging entry: every staged file is counted as unreadable and
  // kept, and nothing replaces the entry (a new key would make them unreadable for good).
  @Test
  fun anUnrecoverableStagingKeyCountsEveryFileAndKeepsThem() {
    store().stage(a, offer(a))
    store().stage(b, offer(b))
    var opened = 0
    val staged = readStagedActivities(dir) {
      opened++
      throw UnrecoverableKeyException("key permanently unusable")
    }
    assertEquals(emptyList<ActivityOffer>(), staged.readable)
    assertEquals(2, staged.unreadable)
    assertEquals(1, opened)
    assertTrue(File(dir, "$a.bin").exists())
    assertTrue(File(dir, "$b.bin").exists())
  }

  // The invalidation shows when a read first uses the key, so it lands in the middle of the listing:
  // items read before it do not count as readable once the key is known to be unusable.
  @Test
  fun anInvalidatedStagingKeyCountsEveryFileEvenAfterOneRead() {
    store().stage(a, offer(a))
    store().stage(b, offer(b))
    val real = store()
    var reads = 0
    val staged = readStaged(real.list()) { id ->
      if (reads++ == 0) real.read(id) else throw KeyPermanentlyInvalidatedException()
    }
    assertEquals(emptyList<ActivityOffer>(), staged.readable)
    assertEquals(2, staged.unreadable)
    assertTrue(File(dir, "$a.bin").exists())
    assertTrue(File(dir, "$b.bin").exists())
  }

  @Test
  fun anUnrecoverableKeyOnReadCountsEveryFile() {
    val staged = readStaged(listOf(a, b)) { throw UnrecoverableKeyException() }
    assertEquals(2, staged.unreadable)
  }

  @Test
  fun anUnusableKeyWithNothingStagedCountsNothing() {
    val staged = readStagedActivities(dir) { throw UnrecoverableKeyException() }
    assertEquals(0, staged.unreadable)
    assertEquals(emptyList<ActivityOffer>(), staged.readable)
  }

  // Files that are not staged items (a .tmp left by a crash, another name) are not counted.
  @Test
  fun onlyStagedItemsAreCountedWhenTheKeyIsUnusable() {
    store().stage(a, offer(a))
    File(dir, "$b.tmp").writeBytes(ByteArray(3))
    File(dir, "notes.bin").writeBytes(ByteArray(3))
    val staged = readStagedActivities(dir) { throw UnrecoverableKeyException() }
    assertEquals(1, staged.unreadable)
  }

  // Only the two named failures count; any other Keystore failure still reaches the caller.
  @Test
  fun anyOtherFailureOpeningTheStoreIsRethrown() {
    store().stage(a, offer(a))
    assertThrows(IllegalStateException::class.java) {
      readStagedActivities(dir) { throw IllegalStateException("busy") }
    }
  }

  @Test
  fun aUsableKeyReadsThroughTheOpenerLikeAStore() {
    store().stage(a, offer(a))
    val staged = readStagedActivities(dir) { store() }
    assertEquals(listOf(a), staged.readable.map { it.activityId })
    assertEquals(0, staged.unreadable)
  }

  @Test
  fun aMissingDirectoryHasNothingStaged() {
    assertNull(dir.listFiles())
    val staged = readStagedActivities(dir) { throw UnrecoverableKeyException() }
    assertEquals(0, staged.unreadable)
  }
}
