package codes.madera.crossfog.platform

import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class StagingStoresTest {
  @get:Rule val tmp = TemporaryFolder()

  private val key = SecretKeySpec(ByteArray(32) { 7 }, "AES")

  @Test
  fun theSameDirectoryGivesTheSameStoreWhateverWayItIsSpelled() {
    val stores = StagingStores()
    val a = File(tmp.root, "staging")
    val first = stores.forDir(a, { key }, {})
    assertSame(first, stores.forDir(File(tmp.root, "staging"), { key }, {}))
    assertSame(first, stores.forDir(File(tmp.root, "x/../staging"), { key }, {}))
  }

  @Test
  fun anotherDirectoryGivesAnotherStore() {
    val stores = StagingStores()
    assertNotSame(
      stores.forDir(File(tmp.root, "staging"), { key }, {}),
      stores.forDir(File(tmp.root, "outbox"), { key }, {}),
    )
  }

  @Test
  fun theKeyIsOnlyAskedForWhenTheStoreIsFirstMade() {
    val stores = StagingStores()
    var asked = 0
    val dir = File(tmp.root, "staging")
    stores.forDir(dir, { asked++; key }, {})
    stores.forDir(dir, { asked++; key }, {})
    assertEquals(1, asked)
  }

  @Test
  fun aKeyThatCannotBeReadLeavesNothingBehindSoTheNextCallTriesAgain() {
    val stores = StagingStores()
    val dir = File(tmp.root, "staging")
    var fail = true
    val attempt = { stores.forDir(dir, { if (fail) throw java.security.UnrecoverableKeyException("gone") else key }, {}) }
    org.junit.Assert.assertThrows(java.security.UnrecoverableKeyException::class.java) { attempt() }
    fail = false
    attempt()
  }

  @Test
  fun twoWritersThroughTheHolderNeverCollideOnAnItem() {
    val stores = StagingStores()
    val dir = File(tmp.root, "staging")
    val id = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
    val pool = Executors.newFixedThreadPool(4)
    val go = CountDownLatch(1)
    val failures = java.util.Collections.synchronizedList(mutableListOf<Throwable>())
    repeat(4) { n ->
      pool.execute {
        try {
          go.await()
          val store = stores.forDir(dir, { key }, {})
          repeat(50) {
            store.stage(id, "v$n-$it".toByteArray())
            store.release(id)
          }
        } catch (e: Throwable) {
          failures += e
        }
      }
    }
    go.countDown()
    pool.shutdown()
    assertTrue(pool.awaitTermination(30, java.util.concurrent.TimeUnit.SECONDS))
    assertEquals(emptyList<Throwable>(), failures)
  }
}
