package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class RecordingOutboxHookTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val logs = mutableListOf<String>()

    private fun box(dirName: String = "outbox") = WatchOutbox(File(tmp.root, dirName), ItemLedger(MemoryLedger(), ItemKind.ACTIVITY), {})

    @Test
    fun aSavedRecordingIsQueuedWithTheEncodersVersion() {
        val box = box()
        RecordingOutboxHook({ g, v -> box.add(g, v) }, "1.4.2") { logs += it }.onSaved("<gpx>a</gpx>".toByteArray())
        val offer = box.next()!!
        assertEquals("1.4.2", offer.encoderVersion)
        assertEquals("<gpx>a</gpx>", offer.gpx)
        assertTrue(logs.isEmpty())
    }

    @Test
    fun aFailedOutboxWriteIsLoggedByClassAndNeverReachesTheRecording() {
        // a file where the directory should be: every write fails
        File(tmp.root, "outbox").writeText("in the way")
        val box = box()
        RecordingOutboxHook({ g, v -> box.add(g, v) }, "v") { logs += it }.onSaved("<gpx>a</gpx>".toByteArray())
        assertEquals(1, logs.size)
        assertFalse(logs.single().contains("gpx"))
        assertFalse(logs.single().contains("outbox"))
    }

    @Test
    fun anUnexpectedThrowFromTheOutboxIsAlsoContainedAndLoggedByClass() {
        val hook = RecordingOutboxHook({ _, _ -> throw IllegalStateException("secret place 48.1,11.5") }, "v") { logs += it }
        hook.onSaved("<gpx>a</gpx>".toByteArray())
        assertEquals(listOf("IllegalStateException"), logs)
    }

    @Test
    fun anErrorFromBuildingTheLinkIsContainedToo() {
        val hook = RecordingOutboxHook({ _, _ -> throw OutOfMemoryError("walk too big") }, "v") { logs += it }
        hook.onSaved("<gpx>a</gpx>".toByteArray())
        assertEquals(listOf("OutOfMemoryError"), logs)
    }

    @Test
    fun aSavedRecordingReachesTheLinksOutboxThroughTheHookTheAppUses() {
        val ledger = ItemLedger(MemoryLedger(), ItemKind.ACTIVITY)
        val outbox = WatchOutbox(File(tmp.root, "outbox"), ledger, {})
        val link =
            WatchLink(
                outbox = outbox,
                ledger = ledger,
                routes = WatchRoutes(MemoryIndex(), { _, _ -> "" }, { false }),
                pins = FilePinStore(File(tmp.root, "link"), {}),
                identityPresent = { true },
            )
        createRecordingHook(log = { logs += it }) { link }.onSaved("<gpx>a</gpx>".toByteArray())
        val offer = outbox.next()!!
        assertEquals("<gpx>a</gpx>", offer.gpx)
        assertEquals(codes.madera.crossfog.watch.BuildConfig.VERSION_NAME.trim().ifEmpty { "unknown" }.take(64), offer.encoderVersion)
        assertTrue(logs.isEmpty())
    }

    @Test
    fun theLinkIsResolvedInsideTheGuardSoItsFirstBuildCannotFailTheSave() {
        val hook = createRecordingHook(log = { logs += it }) { throw IllegalStateException("no preferences") }
        hook.onSaved("<gpx>a</gpx>".toByteArray())
        assertEquals(listOf("IllegalStateException"), logs)
    }

    @Test
    fun aBlankEncoderVersionStillQueuesTheWalk() {
        val box = box()
        RecordingOutboxHook({ g, v -> box.add(g, v) }, "  ") { logs += it }.onSaved("<gpx>a</gpx>".toByteArray())
        assertEquals("unknown", box.next()!!.encoderVersion)
    }

    @Test
    fun anEncoderVersionOverTheLimitIsCutNotRefused() {
        val box = box()
        RecordingOutboxHook({ g, v -> box.add(g, v) }, "v".repeat(100)) { logs += it }.onSaved("<gpx>a</gpx>".toByteArray())
        assertEquals(64, box.next()!!.encoderVersion.length)
    }
}
