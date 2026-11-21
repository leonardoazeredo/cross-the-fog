package codes.madera.crossfog.platform

import android.security.keystore.KeyPermanentlyInvalidatedException
import java.io.File
import java.io.IOException
import java.security.InvalidKeyException
import java.security.UnrecoverableKeyException
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class UnsentRoutesTest {
  @get:Rule val tmp = TemporaryFolder()

  private val sealing = SecretKeySpec(ByteArray(32) { 7 }, "AES")
  private val other = SecretKeySpec(ByteArray(32) { 9 }, "AES")
  private val a = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
  private val b = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0002"
  private val c = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0003"
  private val dir get() = File(tmp.root, "outbox")
  private val reports = mutableListOf<String>()

  private fun store(key: SecretKeySpec = sealing) = StagingStore(dir, key, StoreKind.STAGING, {})

  private fun route(id: String) =
    """{"routeId":"$id","name":"Route","createdAt":"2026-11-16T10:00:00Z","gpx":"<gpx/>"}""".toByteArray()

  private fun discard(open: () -> StagingStore = { store() }) =
    discardUnreadableRoutes(open, { reports += it })

  // A lost staging alias means a new key: what was sealed under the old one can never be opened, so
  // it is counted and removed, and a route sealed under the current key is left for the drain.
  @Test
  fun routesSealedUnderALostKeyAreCountedAndRemovedAndReadableOnesStay() {
    store(other).stage(a, route(a))
    store(other).stage(b, route(b))
    store().stage(c, route(c))
    assertEquals(2, discard())
    assertFalse(File(dir, "$a.bin").exists())
    assertFalse(File(dir, "$b.bin").exists())
    assertTrue(File(dir, "$c.bin").exists())
    assertEquals(route(c).toList(), store().read(c)!!.toList())
    assertEquals(emptyList<String>(), reports)
  }

  @Test
  fun readableRoutesAreNeitherCountedNorTouched() {
    store().stage(a, route(a))
    store().stage(b, route(b))
    assertEquals(0, discard())
    assertEquals(listOf(a, b), store().list())
  }

  @Test
  fun aSecondDrainFindsNothingToCountAgain() {
    store(other).stage(a, route(a))
    assertEquals(1, discard())
    assertEquals(0, discard())
  }

  @Test
  fun anItemThatDoesNotParseOrMatchItsNameIsCountedAndRemoved() {
    store().stage(a, "not json".toByteArray())
    store().stage(b, route(a))
    store().stage(c, route(c))
    assertEquals(2, discard())
    assertEquals(listOf(c), store().list())
  }

  @Test
  fun anOutboxWithNoItemsIsZero() {
    assertEquals(0, discard())
  }

  // A delete that fails is reported by its class alone, and the item is not counted: it is still
  // there, so the drain that finally removes it counts it, once.
  @Test
  fun aFailedDeleteIsReportedByClassOnlyAndNotCountedTwice() {
    store(other).stage(a, route(a))
    store(other).stage(b, route(b))
    var failing = true
    val removed = discardUnreadableRoutes(
      listOf(a, b),
      { store().read(it) },
      { id ->
        if (failing && id == a) throw IOException("cannot delete $dir/$id.bin")
        store().release(id)
      },
      { reports += it },
    )
    assertEquals(1, removed)
    assertEquals(listOf("could not delete an unreadable outbox item: IOException"), reports)
    assertTrue(File(dir, "$a.bin").exists())
    assertFalse(File(dir, "$b.bin").exists())

    failing = false
    reports.clear()
    val next = discardUnreadableRoutes(
      store().list(),
      { store().read(it) },
      { store().release(it) },
      { reports += it },
    )
    assertEquals(1, next)
    assertEquals(emptyList<String>(), reports)
    assertEquals(emptyList<String>(), store().list())
  }

  @Test
  fun aDeleteThatFailsWithAnotherClassIsReportedByThatClass() {
    store(other).stage(a, route(a))
    val removed = discardUnreadableRoutes(
      listOf(a),
      { store().read(it) },
      { throw SecurityException("path $dir") },
      { reports += it },
    )
    assertEquals(0, removed)
    assertEquals(listOf("could not delete an unreadable outbox item: SecurityException"), reports)
  }

  // Nothing can be read at all, so no item is known to be lost: an unusable entry may come back, so the
  // routes are kept and the call counts nothing.
  @Test
  fun anUnusableStagingEntryKeepsEveryRouteAndCountsNothing() {
    store().stage(a, route(a))
    store(other).stage(b, route(b))
    for (e in listOf(UnrecoverableKeyException("x"), KeyPermanentlyInvalidatedException("x"))) {
      assertEquals(0, discardUnreadableRoutes({ throw e }, { reports += it }))
    }
    assertEquals(listOf(a, b), store().list())
    assertEquals(emptyList<String>(), reports)
  }

  @Test
  fun aKeyThatTurnsUnusableMidListingKeepsEveryRoute() {
    store(other).stage(a, route(a))
    store().stage(b, route(b))
    var reads = 0
    val removed = discardUnreadableRoutes(
      listOf(a, b),
      {
        if (++reads == 2) throw KeyPermanentlyInvalidatedException("x")
        store().read(it)
      },
      { store().release(it) },
      { reports += it },
    )
    assertEquals(0, removed)
    assertEquals(listOf(a, b), store().list())
  }

  @Test
  fun anotherKeystoreFailureIsNotCaughtAndDeletesNothing() {
    store(other).stage(a, route(a))
    assertThrows(InvalidKeyException::class.java) {
      discardUnreadableRoutes({ throw InvalidKeyException("x") }, { reports += it })
    }
    assertThrows(InvalidKeyException::class.java) {
      discardUnreadableRoutes(listOf(a), { throw InvalidKeyException("x") }, { store().release(it) }, { reports += it })
    }
    assertEquals(listOf(a), store().list())
  }
}
