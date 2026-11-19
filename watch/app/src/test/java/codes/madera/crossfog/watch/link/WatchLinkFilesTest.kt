package codes.madera.crossfog.watch.link

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

class WatchLinkFilesTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val dir get() = File(tmp.root, "link")
    private val pin = ByteArray(32) { it.toByte() }

    @Test
    fun aPinRoundTripsAndSurvivesANewInstance() {
        FilePinStore(dir, {}).put(pin)
        assertArrayEquals(pin, FilePinStore(dir, {}).get())
    }

    @Test
    fun noFileIsNoPin() {
        assertNull(FilePinStore(dir, {}).get())
    }

    @Test
    fun aPinOfTheWrongSizeReadsAsNoPin() {
        dir.mkdirs()
        File(dir, WatchLinkNames.PIN_FILE).writeBytes(ByteArray(31))
        assertNull(FilePinStore(dir, {}).get())
    }

    @Test
    fun aPinOfTheWrongSizeIsRefusedOnWrite() {
        assertThrows(IllegalArgumentException::class.java) { FilePinStore(dir, {}).put(ByteArray(5)) }
    }

    @Test
    fun clearRemovesThePinAndClearingTwiceIsFine() {
        val store = FilePinStore(dir, {})
        store.put(pin)
        store.clear()
        store.clear()
        assertNull(store.get())
    }

    @Test
    fun clearingWhenNothingWasEverWrittenNeedsNoDirectory() {
        val strict = { d: File -> if (!d.isDirectory) throw IOException("no such directory") }
        FilePinStore(dir, strict).clear()
    }

    @Test
    fun aPutThatFailsBeforeTheRenameLeavesTheOldPinExactly() {
        val store = FilePinStore(dir, {})
        store.put(pin)
        File(dir, "${WatchLinkNames.PIN_FILE}.tmp").mkdir()
        assertThrows(IOException::class.java) { store.put(ByteArray(32) { 9 }) }
        assertArrayEquals(pin, FilePinStore(dir, {}).get())
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

    @Test
    fun theLedgerTextRoundTrips() {
        val store = FileLedgerStore(dir, {})
        assertNull(store.read())
        store.write("ledger1 4\n")
        assertEquals("ledger1 4\n", FileLedgerStore(dir, {}).read())
    }

    @Test
    fun persistedNamesArePinned() {
        assertEquals("outbox", WatchLinkNames.OUTBOX_DIR)
        assertEquals("aside", WatchLinkNames.ASIDE_DIR)
        assertEquals("link", WatchLinkNames.LINK_DIR)
        assertEquals("pin.v1", WatchLinkNames.PIN_FILE)
        assertEquals("ledger.v1", WatchLinkNames.LEDGER_FILE)
        assertEquals("crossfog.link.watch.v1", WatchLinkNames.IDENTITY_ALIAS)
        assertEquals("link_routes", WatchLinkNames.ROUTES_PREFS)
        assertEquals("route-", WatchLinkNames.ROUTE_FILE_PREFIX)
    }
}
