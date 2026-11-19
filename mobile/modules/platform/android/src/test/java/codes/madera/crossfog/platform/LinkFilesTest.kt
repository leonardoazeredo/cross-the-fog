package codes.madera.crossfog.platform

import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import java.io.File
import java.io.IOException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LinkFilesTest {
  @get:Rule val tmp = TemporaryFolder()

  private val dir get() = File(tmp.root, "link")
  private val pin = ByteArray(32) { (it + 1).toByte() }

  @Test
  fun aPinReadsBackAfterItWasPut() {
    val store = FilePinStore(dir, {})
    assertNull(store.get())
    store.put(pin)
    assertArrayEquals(pin, FilePinStore(dir, {}).get())
  }

  @Test
  fun aSecondPutReplacesTheFirst() {
    val store = FilePinStore(dir, {})
    store.put(pin)
    store.put(ByteArray(32) { 9 })
    assertArrayEquals(ByteArray(32) { 9 }, store.get())
  }

  @Test
  fun clearRemovesThePinAndClearingTwiceIsFine() {
    val store = FilePinStore(dir, {})
    store.put(pin)
    store.clear()
    assertNull(store.get())
    store.clear()
  }

  @Test
  fun clearingAfterAWriteSyncsTheDirectory() {
    val synced = mutableListOf<File>()
    val store = FilePinStore(dir, { synced += it })
    store.put(pin)
    synced.clear()
    store.clear()
    assertEquals(listOf(dir), synced)
  }

  @Test
  fun clearingWhenNothingWasEverWrittenNeedsNoDirectory() {
    // a directory sync on a directory that does not exist throws, as the real one does
    val strict = { d: File -> if (!d.isDirectory) throw IOException("no such directory") }
    FilePinStore(dir, strict).clear()
    assertNull(FilePinStore(dir, strict).get())
  }

  @Test
  fun aPinOfTheWrongSizeIsRefused() {
    val store = FilePinStore(dir, {})
    assertThrows(IllegalArgumentException::class.java) { store.put(ByteArray(31)) }
    assertThrows(IllegalArgumentException::class.java) { store.put(ByteArray(33)) }
    assertNull(store.get())
  }

  @Test
  fun aDamagedPinFileReadsAsNoPin() {
    FilePinStore(dir, {}).put(pin)
    File(dir, StoredNames.LINK_PIN_FILE).writeBytes(ByteArray(5))
    assertNull(FilePinStore(dir, {}).get())
  }

  @Test
  fun theCallerSeesTheStoredCopyNotTheCallersArray() {
    val store = FilePinStore(dir, {})
    val given = pin.copyOf()
    store.put(given)
    given.fill(0)
    assertArrayEquals(pin, store.get())
    store.get()!!.fill(0)
    assertArrayEquals(pin, store.get())
  }

  @Test
  fun aPutThatFailsBeforeTheRenameLeavesTheOldPinExactly() {
    val store = FilePinStore(dir, {})
    store.put(pin)
    // the temporary file cannot be created, so the write fails before anything replaces the pin
    File(dir, "${StoredNames.LINK_PIN_FILE}.tmp").mkdir()
    assertThrows(IOException::class.java) { store.put(ByteArray(32) { 9 }) }
    assertArrayEquals(pin, FilePinStore(dir, {}).get())
  }

  @Test
  fun aPutWhoseDirectorySyncFailsStillNeverReadsAHalfWrittenPin() {
    val store = FilePinStore(dir, {})
    store.put(pin)
    val failing = FilePinStore(dir, { throw IOException("sync failed") })
    assertThrows(IOException::class.java) { failing.put(ByteArray(32) { 9 }) }
    val read = FilePinStore(dir, {}).get()
    assertTrue(read != null && (read.contentEquals(pin) || read.contentEquals(ByteArray(32) { 9 })))
  }

  @Test
  fun thePinFileSitsInTheLinkDirectoryUnderItsPinnedName() {
    FilePinStore(dir, {}).put(pin)
    assertTrue(File(dir, "pin.v1").isFile)
  }

  @Test
  fun aLedgerTextReadsBackAndALaterOneReplacesIt() {
    val store = FileLedgerStore(dir, {})
    assertNull(store.read())
    store.write("ledger1 0\n")
    store.write("ledger1 1\n")
    assertEquals("ledger1 1\n", FileLedgerStore(dir, {}).read())
  }

  @Test
  fun aLedgerOverTheFileSurvivesARestart() {
    val id = "11111111-1111-4111-8111-111111111111"
    val first = ItemLedger(FileLedgerStore(dir, {}), ItemKind.ROUTE)
    repeat(3) {
      first.onClosed(
        codes.madera.crossfog.link.CloseInfo(
          codes.madera.crossfog.link.CloseReason.TIMEOUT,
          null,
          codes.madera.crossfog.link.ItemRef(ItemKind.ROUTE, id),
        ),
      )
    }
    val other = "11111111-1111-4111-8111-111111111112"
    assertEquals(other, ItemLedger(FileLedgerStore(dir, {}), ItemKind.ROUTE).prefer(listOf(id, other)))
  }

  @Test
  fun theLedgerFileKeepsItsName() {
    FileLedgerStore(dir, {}).write("ledger1 0\n")
    assertTrue(File(dir, "ledger.v1").isFile)
  }

  @Test
  fun theLinkDirectoryIsSyncedAfterEveryWriteNotOnlyTheFirst() {
    val synced = mutableListOf<File>()
    val store = FilePinStore(dir, { synced += it })
    store.put(pin)
    synced.clear()
    store.put(ByteArray(32) { 9 })
    assertEquals(listOf(dir), synced)
  }
}
