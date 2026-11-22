package codes.madera.crossfog.platform

import codes.madera.crossfog.link.ActivityOffer
import codes.madera.crossfog.link.CloseInfo
import codes.madera.crossfog.link.CloseReason
import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import codes.madera.crossfog.link.ItemRef
import codes.madera.crossfog.link.LedgerStore
import codes.madera.crossfog.link.Refusal
import codes.madera.crossfog.link.RefusalReason
import codes.madera.crossfog.link.Revision
import codes.madera.crossfog.link.RouteOffer
import codes.madera.crossfog.link.SaveResult
import java.io.File
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

private class MemoryLedger : LedgerStore {
  var text: String? = null

  override fun read(): String? = text

  override fun write(text: String) {
    this.text = text
  }
}

class PhoneLinkStoresTest {
  @get:Rule val tmp = TemporaryFolder()

  private val key = SecretKeySpec(ByteArray(32) { 7 }, "AES")
  private val a = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
  private val b = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0002"
  private val c = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0003"
  private val outboxDir get() = File(tmp.root, "outbox")
  private val stagingDir get() = File(tmp.root, "staging")
  private val ledgerStore = MemoryLedger()
  private val saved = mutableListOf<Pair<String, String>>()
  private val staged = mutableListOf<String>()

  private fun outboxStore() = StagingStore(outboxDir, key, {})
  private fun stagingStore() = StagingStore(stagingDir, key, {})
  private fun ledger() = ItemLedger(ledgerStore, ItemKind.ROUTE)

  private fun routes(store: StagingStore = outboxStore(), ledger: ItemLedger = ledger()) =
    OutboxRoutes(store, ledger) { id, rev -> saved += id to rev }

  private fun routeJson(id: String, gpx: String = "<gpx/>") =
    """{"routeId":"$id","name":"Route","createdAt":"2026-11-16T10:00:00Z","gpx":"$gpx"}""".toByteArray()

  private fun offer(id: String, gpx: String = "<gpx>$id</gpx>") =
    RouteOffer(id, "Route", "2026-11-16T10:00:00Z", gpx)

  private fun activity(id: String) = ActivityOffer(id, null, "1", "<gpx>$id</gpx>")

  private fun unconfirmed(id: String) = CloseInfo(CloseReason.TIMEOUT, null, ItemRef(ItemKind.ROUTE, id))

  // ---- the outbox as the phone endpoint's route store

  @Test
  fun anEmptyOutboxHasNothingQueued() {
    assertNull(routes().nextQueued())
  }

  @Test
  fun theOldestQueuedRouteIsOfferedFirst() {
    val r = routes()
    r.queue(a, routeJson(a))
    File(outboxDir, "$a.bin").setLastModified(1_000_000)
    r.queue(b, routeJson(b))
    File(outboxDir, "$b.bin").setLastModified(2_000_000)
    assertEquals(a, r.nextQueued()!!.routeId)
  }

  @Test
  fun aRouteQueuedAgainMovesBehindTheOthers() {
    val r = routes()
    r.queue(a, routeJson(a))
    File(outboxDir, "$a.bin").setLastModified(1_000_000)
    r.queue(b, routeJson(b))
    File(outboxDir, "$b.bin").setLastModified(2_000_000)
    r.queue(a, routeJson(a, "<gpx>edited</gpx>"))
    File(outboxDir, "$a.bin").setLastModified(3_000_000)
    assertEquals(b, r.nextQueued()!!.routeId)
  }

  @Test
  fun aDemotedRouteIsOfferedAfterTheOthers() {
    val l = ledger()
    val r = routes(ledger = l)
    r.queue(a, routeJson(a))
    File(outboxDir, "$a.bin").setLastModified(1_000_000)
    r.queue(b, routeJson(b))
    File(outboxDir, "$b.bin").setLastModified(2_000_000)
    repeat(3) { l.onClosed(unconfirmed(a)) }
    assertEquals(b, r.nextQueued()!!.routeId)
  }

  @Test
  fun anUnreadableRouteDoesNotStopTheOnesBehindIt() {
    val r = routes()
    r.queue(a, routeJson(a))
    File(outboxDir, "$a.bin").setLastModified(1_000_000)
    r.queue(b, routeJson(b))
    File(outboxDir, "$b.bin").setLastModified(2_000_000)
    // sealed under another key: it can never be opened
    StagingStore(outboxDir, SecretKeySpec(ByteArray(32) { 9 }, "AES"), {}).stage(a, routeJson(a))
    File(outboxDir, "$a.bin").setLastModified(1_000_000)
    assertEquals(b, r.nextQueued()!!.routeId)
  }

  @Test
  fun aRouteFileThatDoesNotParseDoesNotStopTheOnesBehindIt() {
    val r = routes()
    outboxStore().stage(a, "not json".toByteArray())
    File(outboxDir, "$a.bin").setLastModified(1_000_000)
    r.queue(b, routeJson(b))
    File(outboxDir, "$b.bin").setLastModified(2_000_000)
    assertEquals(b, r.nextQueued()!!.routeId)
  }

  @Test
  fun aRouteFileFiledUnderAnotherIdIsSkipped() {
    val r = routes()
    outboxStore().stage(a, routeJson(b))
    assertNull(r.nextQueued())
  }

  @Test
  fun deliveringTheOfferedRevisionRemovesTheRouteAndReportsIt() {
    val r = routes()
    r.queue(a, routeJson(a))
    val route = r.nextQueued()!!
    assertTrue(r.markDelivered(route.routeId, route.revision))
    assertNull(r.nextQueued())
    assertEquals(listOf(a to route.revision), saved)
    assertEquals(emptyList<String>(), outboxStore().list())
  }

  @Test
  fun aRouteEditedAfterItWasOfferedIsNotMarkedDeliveredAndNothingIsReported() {
    val r = routes()
    r.queue(a, routeJson(a))
    val offered = r.nextQueued()!!
    r.queue(a, routeJson(a, "<gpx>edited</gpx>"))
    assertFalse(r.markDelivered(a, offered.revision))
    assertTrue(saved.isEmpty())
    assertEquals("<gpx>edited</gpx>", r.nextQueued()!!.gpx)
  }

  @Test
  fun aRouteThatIsGoneIsNotMarkedDelivered() {
    val r = routes()
    assertFalse(r.markDelivered(a, "0".repeat(64)))
    assertTrue(saved.isEmpty())
  }

  @Test
  fun deliveryResetsTheRoutesCountsInTheLedger() {
    val store = MemoryLedger()
    val l = ItemLedger(store, ItemKind.ROUTE)
    val r = OutboxRoutes(outboxStore(), l) { id, rev -> saved += id to rev }
    r.queue(a, routeJson(a))
    r.queue(b, routeJson(b))
    File(outboxDir, "$a.bin").setLastModified(1_000_000)
    File(outboxDir, "$b.bin").setLastModified(2_000_000)
    repeat(3) { l.onClosed(unconfirmed(a)) }
    assertEquals(b, r.nextQueued()!!.routeId)
    val bRoute = r.nextQueued()!!
    r.markDelivered(bRoute.routeId, bRoute.revision)
    val aRoute = r.nextQueued()!!
    r.markDelivered(aRoute.routeId, aRoute.revision)
    r.queue(a, routeJson(a, "<gpx>again</gpx>"))
    r.queue(c, routeJson(c))
    File(outboxDir, "$a.bin").setLastModified(1_000_000)
    File(outboxDir, "$c.bin").setLastModified(2_000_000)
    // a is no longer demoted: it is first by age again
    assertEquals(a, r.nextQueued()!!.routeId)
  }

  @Test
  fun aFailedReleaseIsAnErrorAndReportsAndConfirmsNothing() {
    val l = ledger()
    val r = routes(ledger = l)
    r.queue(a, routeJson(a))
    r.queue(b, routeJson(b))
    File(outboxDir, "$a.bin").setLastModified(1_000_000)
    File(outboxDir, "$b.bin").setLastModified(2_000_000)
    repeat(3) { l.onClosed(unconfirmed(a)) }
    val route = outboxStore().read(a)!!.let { Frames.parseRouteOffer(it) }
    // the file reads fine, but the release then cannot delete the temporary name: a directory with content
    File(outboxDir, "$a.tmp").mkdir()
    File(outboxDir, "$a.tmp/x").writeText("x")
    val countsBefore = ledgerStore.text
    assertThrows(java.io.IOException::class.java) { r.markDelivered(a, route.revision) }
    assertTrue(saved.isEmpty())
    // a delivery that did not finish resets nothing: a keeps its counts
    assertEquals(countsBefore, ledgerStore.text)
  }

  @Test
  fun aRouteThatCannotBeOpenedWhenItIsConfirmedIsNotMarkedDeliveredAndDoesNotThrow() {
    val r = routes()
    r.queue(a, routeJson(a))
    val revision = r.nextQueued()!!.revision
    StagingStore(outboxDir, SecretKeySpec(ByteArray(32) { 9 }, "AES"), {}).stage(a, routeJson(a))
    assertFalse(r.markDelivered(a, revision))
    assertTrue(saved.isEmpty())
  }

  @Test
  fun aConfirmationRacingARequeueNeverLosesTheEdit() {
    val r = routes()
    val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
    try {
      repeat(200) { n ->
        r.queue(a, routeJson(a, "<gpx>rev1-$n</gpx>"))
        val rev1 = r.nextQueued()!!.revision
        val go = java.util.concurrent.CountDownLatch(1)
        val edit = pool.submit { go.await(); r.queue(a, routeJson(a, "<gpx>rev2-$n</gpx>")) }
        val confirm = pool.submit { go.await(); r.markDelivered(a, rev1) }
        go.countDown()
        edit.get()
        confirm.get()
        // either order is fine, but the edited route must be there afterwards, and rev1 must not be reported for it
        assertEquals("<gpx>rev2-$n</gpx>", r.nextQueued()!!.gpx)
        r.setAside(a)
      }
    } finally {
      pool.shutdownNow()
    }
  }

  @Test
  fun aRouteTooLargeToFrameIsRefusedWhereItIsQueued() {
    val r = routes()
    assertThrows(FrameException::class.java) {
      r.queue(a, routeJson(a, "a".repeat(codes.madera.crossfog.link.Framing.MAX_FRAME_BYTES)))
    }
    assertEquals(emptyList<String>(), outboxStore().list())
  }

  @Test
  fun aRouteQueuedUnderAnotherIdThanItsOwnIsRefused() {
    val r = routes()
    assertThrows(FrameException::class.java) { r.queue(a, routeJson(b)) }
  }

  @Test
  fun setAsideTakesTheRouteOutOfTheQueueButKeepsItReadable() {
    val r = routes()
    r.queue(a, routeJson(a))
    r.setAside(a)
    assertNull(r.nextQueued())
    assertEquals(emptyList<String>(), outboxStore().list())
    assertTrue(File(outboxDir, "aside/$a.bin").isFile)
    assertArrayEquals(routeJson(a), outboxStore().readAside(a))
  }

  @Test
  fun aRouteSetAsideAndQueuedAgainStartsWithFreshCounts() {
    val l = ledger()
    val r = routes(ledger = l)
    val events = LedgerEvents(l, r) { _, _ -> }
    r.queue(a, routeJson(a))
    repeat(3) {
      events.closedWith(CloseInfo(CloseReason.STORE_FAILED, ItemRef(ItemKind.ROUTE, a), ItemRef(ItemKind.ROUTE, a)))
    }
    assertNull(r.nextQueued())
    r.queue(a, routeJson(a, "<gpx>again</gpx>"))
    repeat(2) {
      events.closedWith(CloseInfo(CloseReason.STORE_FAILED, ItemRef(ItemKind.ROUTE, a), ItemRef(ItemKind.ROUTE, a)))
    }
    assertEquals(a, r.nextQueued()!!.routeId)
  }

  @Test
  fun aRouteSetAsideTwiceKeepsTheLaterCopy() {
    val r = routes()
    r.queue(a, routeJson(a))
    r.setAside(a)
    r.queue(a, routeJson(a, "<gpx>later</gpx>"))
    r.setAside(a)
    assertEquals(
      "<gpx>later</gpx>",
      Frames.parseRouteOffer(outboxStore().readAside(a)!!).gpx,
    )
  }

  @Test
  fun anAsideCopyThatIsGoneReadsAsNullAndADamagedOneIsUnreadable() {
    val r = routes()
    assertNull(outboxStore().readAside(a))
    r.queue(a, routeJson(a))
    r.setAside(a)
    File(outboxDir, "aside/$a.bin").writeBytes(ByteArray(40))
    assertThrows(UnreadableItemException::class.java) { outboxStore().readAside(a) }
  }

  @Test
  fun aReadErrorWhileReportingTheRevisionDoesNotStopTheSetAside() {
    val r = routes()
    r.queue(a, routeJson(a))
    // reading the file fails with an I/O error, not a parse error
    File(outboxDir, "$a.bin").delete()
    File(outboxDir, "$a.bin").mkdir()
    assertNull(r.setAside(a))
    assertTrue(File(outboxDir, "aside/$a.bin").exists())
  }

  @Test
  fun settingAsideARouteThatIsGoneIsNotAnError() {
    assertNull(routes().setAside(a))
  }

  @Test
  fun settingAsideReturnsTheRevisionOfTheRouteThatLeft() {
    val r = routes()
    r.queue(a, routeJson(a))
    val revision = r.nextQueued()!!.revision
    assertEquals(revision, r.setAside(a))
  }

  @Test
  fun settingAsideARouteThatCannotBeOpenedStillMovesItAndReturnsNoRevision() {
    val r = routes()
    outboxStore().stage(a, "not json".toByteArray())
    assertNull(r.setAside(a))
    assertEquals(emptyList<String>(), outboxStore().list())
    assertTrue(File(outboxDir, "aside/$a.bin").isFile)
  }

  // ---- the staging store as the phone endpoint's activity sink

  private fun sink() = StagingSink(stagingStore()) { staged += it }

  @Test
  fun anActivityIsStagedAndAnnouncedOnce() {
    val s = sink()
    assertEquals(SaveResult.SAVED, s.store(activity(a)))
    assertEquals(listOf(a), staged)
    assertEquals(listOf(a), stagingStore().list())
    assertEquals(a, Frames.parseActivityOffer(stagingStore().read(a)!!).activityId)
  }

  @Test
  fun aStagedCopyThatCannotBeOpenedIsStagedAgainSoTheWalkIsNotLost() {
    // sealed under a key that was since replaced
    StagingStore(stagingDir, SecretKeySpec(ByteArray(32) { 9 }, "AES"), {}).stage(a, "x".toByteArray())
    assertEquals(SaveResult.SAVED, sink().store(activity(a)))
    assertEquals(listOf(a), staged)
    assertEquals(a, Frames.parseActivityOffer(stagingStore().read(a)!!).activityId)
  }

  @Test
  fun everyFieldOfTheOfferComesBackFromTheStagedFile() {
    val full = ActivityOffer(a, b, "enc-9", "<gpx>full</gpx>")
    sink().store(full)
    val back = Frames.parseActivityOffer(stagingStore().read(a)!!)
    assertEquals(full.activityId, back.activityId)
    assertEquals(full.routeId, back.routeId)
    assertEquals(full.encoderVersion, back.encoderVersion)
    assertEquals(full.gpx, back.gpx)
    val without = ActivityOffer(c, null, "enc-9", "<gpx>x</gpx>")
    sink().store(without)
    assertNull(Frames.parseActivityOffer(stagingStore().read(c)!!).routeId)
  }

  @Test
  fun anActivityAlreadyStagedIsAlreadyHeldAndWritesAndAnnouncesNothing() {
    val s = sink()
    s.store(activity(a))
    val before = File(stagingDir, "$a.bin").readBytes()
    assertEquals(SaveResult.ALREADY_HELD, s.store(activity(a)))
    assertEquals(listOf(a), staged)
    assertArrayEquals(before, File(stagingDir, "$a.bin").readBytes())
  }

  // The page's store, not this sink, is what keeps a released activity from becoming a second walk
  // (ActivityStore.add is idempotent by id), so a resend after release is staged again and announced.
  @Test
  fun anActivityResentAfterThePageReleasedItIsStagedAgain() {
    val store = stagingStore()
    val s = StagingSink(store) { staged += it }
    s.store(activity(a))
    store.release(a)
    assertEquals(SaveResult.SAVED, s.store(activity(a)))
    assertEquals(listOf(a, a), staged)
  }

  @Test
  fun aStoreThatCannotWriteMakesTheSinkThrowAndAnnounceNothing() {
    val failing = StagingStore(stagingDir, key, { throw java.io.IOException("sync failed") })
    val s = StagingSink(failing) { staged += it }
    assertThrows(java.io.IOException::class.java) { s.store(activity(a)) }
    assertTrue(staged.isEmpty())
  }

  // ---- the ledger's actions applied to the outbox

  @Test
  fun aRouteSetAsideByTheLedgerLeavesTheQueueAndIsAnnounced() {
    val l = ledger()
    val r = routes(ledger = l)
    val asides = mutableListOf<Pair<String, String?>>()
    val events = LedgerEvents(l, r) { id, revision -> asides += id to revision }
    r.queue(a, routeJson(a))
    val revision = r.nextQueued()!!.revision
    repeat(3) {
      events.closedWith(CloseInfo(CloseReason.STORE_FAILED, ItemRef(ItemKind.ROUTE, a), ItemRef(ItemKind.ROUTE, a)))
    }
    assertEquals(listOf(a to revision), asides)
    assertNull(r.nextQueued())
    assertTrue(File(outboxDir, "aside/$a.bin").isFile)
  }

  @Test
  fun aDemotionAnnouncesNothingAndKeepsTheRouteQueued() {
    val l = ledger()
    val r = routes(ledger = l)
    val asides = mutableListOf<Pair<String, String?>>()
    val events = LedgerEvents(l, r) { id, revision -> asides += id to revision }
    r.queue(a, routeJson(a))
    repeat(3) { events.closedWith(unconfirmed(a)) }
    assertTrue(asides.isEmpty())
    assertEquals(a, r.nextQueued()!!.routeId)
  }

  // ---- a refusal from the watch

  @Test
  fun aRouteTheWatchRefusedIsSetAsideAtOnceAndAnnouncedWithItsRevision() {
    val l = ledger()
    val r = routes(ledger = l)
    val asides = mutableListOf<Pair<String, String?>>()
    val events = LedgerEvents(l, r) { id, revision -> asides += id to revision }
    r.queue(a, routeJson(a))
    r.queue(b, routeJson(b))
    val revision = r.nextQueued()!!.revision
    events.itemRefused(Refusal(ItemRef(ItemKind.ROUTE, a), RefusalReason.UNREADABLE, revision))
    assertEquals(listOf(a to revision), asides)
    assertEquals(b, r.nextQueued()!!.routeId)
    assertTrue("kept, not deleted", File(outboxDir, "aside/$a.bin").isFile)
  }

  @Test
  fun aRefusalOfARevisionThatWasEditedMeanwhileLeavesTheNewCopyQueued() {
    val l = ledger()
    val r = routes(ledger = l)
    val asides = mutableListOf<Pair<String, String?>>()
    val events = LedgerEvents(l, r) { id, revision -> asides += id to revision }
    r.queue(a, routeJson(a))
    val offered = r.nextQueued()!!.revision
    r.queue(a, routeJson(a, gpx = "<gpx>edited</gpx>"))
    events.itemRefused(Refusal(ItemRef(ItemKind.ROUTE, a), RefusalReason.UNREADABLE, offered))
    assertTrue(asides.isEmpty())
    assertEquals(a, r.nextQueued()!!.routeId)
    assertFalse(File(outboxDir, "aside/$a.bin").exists())
  }

  @Test
  fun aRefusalOfARouteThatIsGoneAnnouncesNothing() {
    val l = ledger()
    val r = routes(ledger = l)
    val asides = mutableListOf<Pair<String, String?>>()
    val events = LedgerEvents(l, r) { id, revision -> asides += id to revision }
    events.itemRefused(Refusal(ItemRef(ItemKind.ROUTE, a), RefusalReason.UNREADABLE, "0".repeat(64)))
    assertTrue(asides.isEmpty())
  }

  @Test
  fun aRefusalOfARouteWhoseQueuedCopyCannotBeReadAnnouncesNothingAndDoesNotThrow() {
    for (damage in listOf("sealed under another key", "not json", "filed under another id")) {
      val l = ledger()
      val r = routes(ledger = l)
      val asides = mutableListOf<Pair<String, String?>>()
      val events = LedgerEvents(l, r) { id, revision -> asides += id to revision }
      outboxDir.deleteRecursively()
      when (damage) {
        "sealed under another key" -> StagingStore(outboxDir, SecretKeySpec(ByteArray(32) { 9 }, "AES"), {}).stage(a, routeJson(a))
        "not json" -> outboxStore().stage(a, "not json".toByteArray())
        else -> outboxStore().stage(a, routeJson(b))
      }
      // the misfiled copy's own revision, so only the id check keeps it from being set aside
      val revision = if (damage == "filed under another id") Revision.of("<gpx/>") else "0".repeat(64)
      events.itemRefused(Refusal(ItemRef(ItemKind.ROUTE, a), RefusalReason.UNREADABLE, revision))
      assertTrue(damage, asides.isEmpty())
      assertTrue(damage, File(outboxDir, "$a.bin").exists())
      assertFalse(damage, File(outboxDir, "aside").exists())
    }
  }

  @Test
  fun aRefusalOfAnActivityIsNotThePhonesToAct() {
    val l = ledger()
    val r = routes(ledger = l)
    val asides = mutableListOf<Pair<String, String?>>()
    val events = LedgerEvents(l, r) { id, revision -> asides += id to revision }
    r.queue(a, routeJson(a))
    events.itemRefused(Refusal(ItemRef(ItemKind.ACTIVITY, a), RefusalReason.UNREADABLE, null))
    assertTrue(asides.isEmpty())
    assertEquals(a, r.nextQueued()!!.routeId)
  }
}
