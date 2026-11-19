package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import codes.madera.crossfog.link.Messages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

class WatchOutboxTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val ledgerStore = MemoryLedger()
    private val dir get() = File(tmp.root, "outbox")

    private fun ledger() = ItemLedger(ledgerStore, ItemKind.ACTIVITY)

    private fun outbox(
        syncDir: (File) -> Unit = {},
        ledger: ItemLedger = ledger(),
    ) = WatchOutbox(dir, ledger, syncDir)

    private fun gpx(n: Int = 1) = "<gpx>walk $n</gpx>".toByteArray()

    private fun ids(vararg id: String): () -> String {
        val queue = id.toMutableList()
        return { queue.removeAt(0) }
    }

    @Test
    fun aSavedWalkIsOfferedWithItsGpxAndTheEncodersVersion() {
        val box = outbox()
        val id = box.add(gpx(), "1.4.2", newId = ids(ID_A))
        assertEquals(ID_A, id)
        val offer = box.next()!!
        assertEquals(ID_A, offer.activityId)
        assertEquals("1.4.2", offer.encoderVersion)
        assertEquals("<gpx>walk 1</gpx>", offer.gpx)
        assertNull(offer.routeId)
    }

    @Test
    fun everySaveGetsItsOwnNewId() {
        val box = outbox()
        val first = box.add(gpx(), "v")
        val second = box.add(gpx(), "v")
        assertNotEquals(first, second)
        assertEquals(2, box.queuedCount())
    }

    @Test
    fun theOldestWalkIsOfferedFirst() {
        val box = outbox()
        box.add(gpx(1), "v", newId = ids(ID_A))
        box.add(gpx(2), "v", newId = ids(ID_B))
        File(dir, "$ID_A.json").setLastModified(2_000_000)
        File(dir, "$ID_B.json").setLastModified(1_000_000)
        assertEquals(ID_B, box.next()!!.activityId)
    }

    @Test
    fun deletingRemovesTheWalkAndAbsentIsNotAnError() {
        val box = outbox()
        box.add(gpx(), "v", newId = ids(ID_A))
        box.delete(ID_A)
        box.delete(ID_A)
        assertNull(box.next())
        assertEquals(0, box.queuedCount())
    }

    @Test
    fun aWalkThatCannotBeReadDoesNotStopTheOnesBehindIt() {
        val box = outbox()
        box.add(gpx(1), "v", newId = ids(ID_A))
        box.add(gpx(2), "v", newId = ids(ID_B))
        File(dir, "$ID_A.json").setLastModified(1_000_000)
        File(dir, "$ID_B.json").setLastModified(2_000_000)
        File(dir, "$ID_A.json").writeText("not a message")
        assertEquals(ID_B, box.next()!!.activityId)
    }

    @Test
    fun aFileFiledUnderAnotherIdIsNotOffered() {
        val box = outbox()
        box.add(gpx(), "v", newId = ids(ID_A))
        File(dir, "$ID_A.json").renameTo(File(dir, "$ID_B.json"))
        assertNull(box.next())
    }

    @Test
    fun otherFilesInTheDirectoryAreIgnored() {
        val box = outbox()
        box.add(gpx(), "v", newId = ids(ID_A))
        File(dir, "notes.txt").writeText("x")
        File(dir, "$ID_B.json.tmp").writeText("half")
        assertEquals(ID_A, box.next()!!.activityId)
        assertEquals(1, box.queuedCount())
    }

    @Test
    fun aWalkQueuedBeforeARestartIsStillThereAfterIt() {
        outbox().add(gpx(), "v", newId = ids(ID_A))
        assertEquals(ID_A, outbox().next()!!.activityId)
    }

    @Test
    fun theFileHoldsTheWireFormOfTheOfferSoTheLinkCanReadItBack() {
        val box = outbox()
        box.add(gpx(), "v", newId = ids(ID_A))
        val parsed = Messages.parse(File(dir, "$ID_A.json").readBytes())
        assertEquals(box.next(), parsed)
    }

    @Test
    fun theDirectoryEntryIsSyncedAfterEveryWrite() {
        val synced = mutableListOf<File>()
        val box = outbox(syncDir = { synced += it })
        box.add(gpx(1), "v", newId = ids(ID_A))
        synced.clear()
        box.add(gpx(2), "v", newId = ids(ID_B))
        assertEquals(listOf(dir), synced)
    }

    @Test
    fun aWriteThatFailsLeavesNoHalfWrittenWalkAndNothingQueued() {
        val box = outbox()
        // the temporary name is a directory, so the file cannot be created
        dir.mkdirs()
        File(dir, "$ID_A.json.tmp").mkdir()
        assertThrows(IOException::class.java) { box.add(gpx(), "v", newId = ids(ID_A)) }
        assertNull(box.next())
        assertEquals(0, box.queuedCount())
    }

    @Test
    fun aWalkTooBigForOneFrameIsRefusedAndNothingIsQueued() {
        val box = outbox()
        val tooBig = ByteArray(codes.madera.crossfog.link.Framing.MAX_FRAME_BYTES + 1) { 'a'.code.toByte() }
        assertThrows(Exception::class.java) { box.add(tooBig, "v", newId = ids(ID_A)) }
        assertEquals(0, box.queuedCount())
    }

    // ---- aside

    @Test
    fun settingAsideMovesTheWalkOutOfTheQueueWithoutDeletingIt() {
        val box = outbox()
        box.add(gpx(), "v", newId = ids(ID_A))
        box.setAside(ID_A)
        assertNull(box.next())
        assertEquals(0, box.queuedCount())
        assertEquals(1, box.asideCount())
        assertTrue(File(dir, "aside/$ID_A.json").isFile)
        assertEquals(
            "<gpx>walk 1</gpx>",
            (Messages.parse(File(dir, "aside/$ID_A.json").readBytes()) as codes.madera.crossfog.link.ActivityOffer).gpx,
        )
    }

    @Test
    fun settingAsideAWalkThatIsGoneIsNotAnError() {
        outbox().setAside(ID_A)
        assertEquals(0, outbox().asideCount())
    }

    @Test
    fun aSecondWalkSetAsideUnderTheSameIdKeepsTheLaterCopy() {
        val box = outbox()
        box.add(gpx(1), "v", newId = ids(ID_A))
        box.setAside(ID_A)
        box.add(gpx(2), "v", newId = ids(ID_A))
        box.setAside(ID_A)
        assertEquals(1, box.asideCount())
        assertEquals(
            "<gpx>walk 2</gpx>",
            (Messages.parse(File(dir, "aside/$ID_A.json").readBytes()) as codes.madera.crossfog.link.ActivityOffer).gpx,
        )
    }

    @Test
    fun asideWalksAreNotListedAsQueued() {
        val box = outbox()
        box.add(gpx(1), "v", newId = ids(ID_A))
        box.add(gpx(2), "v", newId = ids(ID_B))
        box.setAside(ID_A)
        assertEquals(1, box.queuedCount())
        assertEquals(ID_B, box.next()!!.activityId)
    }

    // ---- ledger

    @Test
    fun aDemotedWalkIsOfferedAfterTheOthers() {
        val l = ledger()
        val box = outbox(ledger = l)
        box.add(gpx(1), "v", newId = ids(ID_A))
        box.add(gpx(2), "v", newId = ids(ID_B))
        File(dir, "$ID_A.json").setLastModified(1_000_000)
        File(dir, "$ID_B.json").setLastModified(2_000_000)
        repeat(3) { l.onClosed(unconfirmed(ID_A)) }
        assertEquals(ID_B, box.next()!!.activityId)
    }

    @Test
    fun deliveryResetsTheWalksCounts() {
        val l = ledger()
        val box = outbox(ledger = l)
        box.add(gpx(), "v", newId = ids(ID_A))
        repeat(2) { l.onClosed(storeFailed(ID_A)) }
        box.delete(ID_A)
        assertEquals(null, ledgerStore.text?.lines()?.firstOrNull { it.startsWith(ID_A) })
    }

    @Test
    fun aWalkSetAsideAndQueuedAgainStartsWithFreshCounts() {
        val l = ledger()
        val box = outbox(ledger = l)
        val events = WatchLinkEvents(l, box)
        box.add(gpx(1), "v", newId = ids(ID_A))
        repeat(3) { events.closedWith(storeFailed(ID_A)) }
        assertEquals(1, box.asideCount())
        box.add(gpx(2), "v", newId = ids(ID_A))
        repeat(2) { events.closedWith(storeFailed(ID_A)) }
        assertEquals(ID_A, box.next()!!.activityId)
    }
}
