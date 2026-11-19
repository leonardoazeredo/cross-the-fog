package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class WatchLinkStatusTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val pins by lazy { FilePinStore(File(tmp.root, "link"), {}) }
    private val ledger = ItemLedger(MemoryLedger(), ItemKind.ACTIVITY)
    private val box get() = WatchOutbox(File(tmp.root, "outbox"), ledger, {})

    private fun link(identityPresent: () -> Boolean = { true }) =
        WatchLink(
            outbox = box,
            ledger = ledger,
            routes = WatchRoutes(MemoryIndex(), { _, _ -> "" }, { false }),
            pins = pins,
            identityPresent = identityPresent,
            encoderVersion = "v",
            log = {},
        )

    @Test
    fun aFreshWatchIsNotPairedAndHasNoWalksWaiting() {
        val status = link().status()
        assertFalse(status.paired)
        assertEquals(0, status.asideWalks)
    }

    @Test
    fun aPinTogetherWithItsKeyIsPaired() {
        pins.put(ByteArray(32) { 1 })
        assertTrue(link().status().paired)
    }

    @Test
    fun aPinWhoseKeyIsGoneIsNotPairedAndIsCleared() {
        pins.put(ByteArray(32) { 1 })
        assertFalse(link { false }.status().paired)
        assertNull(pins.get())
    }

    @Test
    fun anIdentityCheckThatThrowsReadsAsNotPairedButKeepsThePin() {
        pins.put(ByteArray(32) { 1 })
        assertFalse(link { throw IllegalStateException("keystore") }.status().paired)
        assertTrue(pins.get() != null)
    }

    @Test
    fun walksSetAsideAreCounted() {
        val l = link()
        l.recordingHook.onSaved("<gpx>a</gpx>".toByteArray())
        val id = l.outbox.next()!!.activityId
        l.outbox.setAside(id)
        assertEquals(1, l.status().asideWalks)
    }

    @Test
    fun aSavedRecordingIsInTheOutboxFromTheLinkItself() {
        val l = link()
        l.recordingHook.onSaved("<gpx>a</gpx>".toByteArray())
        assertEquals("v", l.outbox.next()!!.encoderVersion)
    }
}
