package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.CloseInfo
import codes.madera.crossfog.link.CloseReason
import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import codes.madera.crossfog.link.ItemRef
import codes.madera.crossfog.link.Refusal
import codes.madera.crossfog.link.RefusalReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class WatchLinkEventsTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val store = MemoryLedger()
    private val ledger = ItemLedger(store, ItemKind.ACTIVITY)

    private fun box() = WatchOutbox(File(tmp.root, "outbox"), ledger, {})

    @Test
    fun anActivityThatFailsHereThreeTimesIsSetAsideNotDeleted() {
        val box = box()
        val events = WatchLinkEvents(ledger, box)
        box.add("<gpx>a</gpx>".toByteArray(), "v", newId = { ID_A })
        repeat(2) { events.closedWith(storeFailed(ID_A)) }
        assertEquals(ID_A, box.next()!!.activityId)
        events.closedWith(storeFailed(ID_A))
        assertNull(box.next())
        assertEquals(1, box.asideCount())
    }

    @Test
    fun aSessionThatEndsOnAnActivityTheWatchNeverHeardConfirmedOnlyDemotesIt() {
        val box = box()
        val events = WatchLinkEvents(ledger, box)
        box.add("<gpx>a</gpx>".toByteArray(), "v", newId = { ID_A })
        repeat(5) { events.closedWith(unconfirmed(ID_A)) }
        assertEquals(0, box.asideCount())
        assertEquals(ID_A, box.next()!!.activityId)
    }

    @Test
    fun aRouteThatFailedItsSaveIsNotThisEndsWalk() {
        val box = box()
        val events = WatchLinkEvents(ledger, box)
        box.add("<gpx>a</gpx>".toByteArray(), "v", newId = { ID_A })
        val route = ItemRef(ItemKind.ROUTE, ID_B)
        repeat(5) { events.closedWith(CloseInfo(CloseReason.STORE_FAILED, route, null)) }
        assertEquals(0, box.asideCount())
        assertEquals(ID_A, box.next()!!.activityId)
    }

    @Test
    fun theCountsOutliveAnInstanceOfTheLedger() {
        val box = box()
        box.add("<gpx>a</gpx>".toByteArray(), "v", newId = { ID_A })
        // each session builds a new ledger over the same stored counts
        repeat(2) { WatchLinkEvents(ItemLedger(store, ItemKind.ACTIVITY), box).closedWith(storeFailed(ID_A)) }
        WatchLinkEvents(ItemLedger(store, ItemKind.ACTIVITY), box).closedWith(storeFailed(ID_A))
        assertEquals(1, box.asideCount())
    }

    @Test
    fun readyAndTheLegacyCloseDoNothing() {
        val events = WatchLinkEvents(ledger, box())
        events.ready()
        events.closed(CloseReason.LOCAL, null)
    }

    @Test
    fun anActivityThePhoneRefusedIsSetAsideAtOnceNotDeleted() {
        val box = box()
        val events = WatchLinkEvents(ledger, box)
        box.add("<gpx>a</gpx>".toByteArray(), "v", newId = { ID_A })
        box.add("<gpx>b</gpx>".toByteArray(), "v", newId = { ID_B })
        events.itemRefused(Refusal(ItemRef(ItemKind.ACTIVITY, ID_A), RefusalReason.UNREADABLE, null))
        assertEquals(ID_B, box.next()!!.activityId)
        assertEquals(1, box.asideCount())
    }

    @Test
    fun aRefusalOfARouteIsNotThisEndsToAct() {
        val box = box()
        val events = WatchLinkEvents(ledger, box)
        box.add("<gpx>a</gpx>".toByteArray(), "v", newId = { ID_A })
        events.itemRefused(Refusal(ItemRef(ItemKind.ROUTE, ID_A), RefusalReason.UNREADABLE, null))
        assertEquals(0, box.asideCount())
        assertEquals(ID_A, box.next()!!.activityId)
    }
}
