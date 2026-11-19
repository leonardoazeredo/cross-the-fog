package codes.madera.crossfog.platform

import android.security.keystore.KeyPermanentlyInvalidatedException
import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import java.io.File
import java.security.UnrecoverableKeyException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import javax.crypto.spec.SecretKeySpec

/**
 * What each of the four calls (`stage`, `read`, `release`, the outbox's `queue`) answers when the key
 * lookup that builds its store throws what an unusable Keystore entry throws: the code
 * ERR_STAGING_KEY_UNUSABLE, nothing on disk changed, and the next call asks the key again. The lookup
 * fails when the store is built, so the bodies of the calls are not entered. A key that fails only at
 * its first use is not simulated (a JDK cipher wraps what a fake provider throws; the Android Keystore
 * throws it from `Cipher.init` as is), and the module's own lazy wiring, which resolves the store
 * inside its `coded` block, is not run here.
 */
class StagingKeyUnusableTest {
  @get:Rule val tmp = TemporaryFolder()

  private val id = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
  private val dir get() = File(tmp.root, "staging")
  private val sealing = SecretKeySpec(ByteArray(32) { 7 }, "AES")
  private val activity = """{"activityId":"$id","encoderVersion":"1","gpx":"<gpx/>"}""".toByteArray()
  private val route =
    """{"routeId":"$id","name":"r","createdAt":"2026-11-19T10:00:00.000Z","gpx":"<gpx/>"}""".toByteArray()

  private val unusable =
    listOf<Exception>(UnrecoverableKeyException("alias"), KeyPermanentlyInvalidatedException("alias"))

  private fun failureOf(call: () -> Unit): Failure? =
    try {
      call()
      null
    } catch (e: Exception) {
      stagingCallFailure(e)
    }

  private fun stores(e: Exception) = StagingStores().forDirWith(e)

  private fun StagingStores.forDirWith(e: Exception): () -> StagingStore = { forDir(dir, { throw e }, {}) }

  private fun everyCall(): Map<String, (() -> StagingStore) -> Unit> =
    mapOf(
      "stage" to { store -> store().stage(id, activity) },
      "read" to { store -> store().read(id) },
      "release" to { store -> store().release(id) },
      "outbox.stage" to { store ->
        val outbox = OutboxRoutes(store(), ItemLedger(FileLedgerStore(File(tmp.root, "link"), {}), ItemKind.ROUTE)) { _, _ -> }
        outbox.queue(id, route)
      },
    )

  @Test
  fun everyCallAnswersTheNamedFailure() {
    for (e in unusable) {
      for ((name, call) in everyCall()) {
        val failure = failureOf { call(stores(e)) }
        assertEquals("$name with ${e.javaClass.simpleName}", "ERR_STAGING_KEY_UNUSABLE", failure?.code)
      }
    }
  }

  @Test
  fun nothingIsDeletedAndNoStoreIsLeftBehind() {
    // An item the page has not handed off is the only copy the watch gave up.
    StagingStore(dir, sealing, {}).stage(id, activity)
    val before = dir.listFiles().orEmpty().map { it.name to it.length() }.sortedBy { it.first }
    for (e in unusable) {
      for ((_, call) in everyCall()) failureOf { call(stores(e)) }
    }
    assertEquals(before, dir.listFiles().orEmpty().map { it.name to it.length() }.sortedBy { it.first })
    assertTrue(File(dir, "$id.bin").exists())
  }

  @Test
  fun theNextCallAsksTheKeyAgain() {
    // The lookup failed, so nothing was cached: a later call with a usable key works.
    val shared = StagingStores()
    assertEquals("ERR_STAGING_KEY_UNUSABLE", failureOf { shared.forDir(dir, { throw unusable[0] }, {}).stage(id, activity) }?.code)
    shared.forDir(dir, { sealing }, {}).stage(id, activity)
    assertTrue(File(dir, "$id.bin").exists())
  }
}
