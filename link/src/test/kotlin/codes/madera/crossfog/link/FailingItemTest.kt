package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone's queue the way an app builds it: the ledger picks which queued route goes next. */
class LedgerRoutes(private val inner: FakePhoneRoutes, private val ledger: () -> ItemLedger) : PhoneRouteStore {
  val failMarkFor = mutableSetOf<String>()

  override fun nextQueued(): RouteOffer? = ledger().prefer(inner.queued.keys.toList())?.let { inner.queued[it] }

  override fun markDelivered(routeId: String, revision: String): Boolean {
    if (routeId in failMarkFor) throw IllegalStateException("store failed")
    return inner.markDelivered(routeId, revision).also { if (it) ledger().confirmed(routeId) }
  }
}

class LedgerOutbox(private val inner: FakeOutbox, private val ledger: () -> ItemLedger) : ActivityOutbox {
  val failDeleteFor = mutableSetOf<String>()

  override fun next(): ActivityOffer? = ledger().prefer(inner.queued.keys.toList())?.let { inner.queued[it] }

  override fun delete(activityId: String) {
    if (activityId in failDeleteFor) throw IllegalStateException("store failed")
    inner.delete(activityId)
  }
}

/** Runs sessions between one phone and one watch, the way each app's loop would, over stores that outlive a session. */
class Sessions2(val clock: FakeClock = FakeClock()) {
  val phoneStore = MemoryLedgerStore()
  val watchStore = MemoryLedgerStore()
  var phoneLedger = ItemLedger(phoneStore, ItemKind.ROUTE)
  var watchLedger = ItemLedger(watchStore, ItemKind.ACTIVITY)
  val phoneQueue = FakePhoneRoutes()
  val phoneRoutes = LedgerRoutes(phoneQueue) { phoneLedger }
  val sink = FakeSink()
  val watchRoutes = FakeWatchRoutes()
  val outboxQueue = FakeOutbox()
  val outbox = LedgerOutbox(outboxQueue) { watchLedger }
  val phoneAside = mutableListOf<String>()
  val watchAside = mutableListOf<String>()
  val phoneEnds = mutableListOf<CloseInfo>()
  val watchEnds = mutableListOf<CloseInfo>()

  fun restart() {
    phoneLedger = ItemLedger(phoneStore, ItemKind.ROUTE)
    watchLedger = ItemLedger(watchStore, ItemKind.ACTIVITY)
  }

  /** One session: both ends open, bytes move until quiet; with [stall] the watch's answers after its hello are lost and the confirmation wait runs out. */
  fun session(stall: Boolean = false) {
    val config = LinkConfig()
    val phoneStream = MemoryStream()
    val watchStream = MemoryStream()
    val phoneEvents = object : LinkEvents {
      override fun ready() = Unit

      override fun closed(reason: CloseReason, itemId: String?) = Unit

      override fun closedWith(info: CloseInfo) {
        phoneEnds += info
        for (a in phoneLedger.onClosed(info)) if (a is LedgerAction.SetAside) {
          phoneQueue.queued.remove(a.item.id)
          phoneLedger.forget(a.item.id)
          phoneAside += a.item.id
        }
      }
    }
    val watchEvents = object : LinkEvents {
      override fun ready() = Unit

      override fun closed(reason: CloseReason, itemId: String?) = Unit

      override fun closedWith(info: CloseInfo) {
        watchEnds += info
        for (a in watchLedger.onClosed(info)) if (a is LedgerAction.SetAside) {
          outboxQueue.queued.remove(a.item.id)
          watchLedger.forget(a.item.id)
          watchAside += a.item.id
        }
      }
    }
    val phone = PhoneEndpoint(phoneStream, clock, phoneRoutes, sink, phoneEvents, config)
    val watch = WatchEndpoint(watchStream, clock, watchRoutes, outboxQueueView(), watchEvents, config)
    phone.open()
    watch.open()
    repeat(200) { round ->
      val toWatch = phoneStream.take()
      // the hellos pass, so the route is offered; every answer after them is lost
      val toPhone = if (stall && round > 0) ByteArray(0).also { watchStream.take() } else watchStream.take()
      if (toWatch.isEmpty() && toPhone.isEmpty()) return finish(phone, watch, stall)
      Pair2.feed(watch, toWatch, Int.MAX_VALUE)
      Pair2.feed(phone, toPhone, Int.MAX_VALUE)
    }
    error("never quiet")
  }

  private fun outboxQueueView(): ActivityOutbox = object : ActivityOutbox {
    override fun next() = outbox.next()

    override fun delete(activityId: String) {
      outbox.delete(activityId)
      watchLedger.confirmed(activityId)
    }
  }

  private fun finish(phone: PhoneEndpoint, watch: WatchEndpoint, stall: Boolean) {
    if (stall) {
      clock.now += LinkConfig().confirmTimeoutMs + 1
      phone.tick()
      watch.tick()
    } else {
      phone.onClosed()
      watch.onClosed()
    }
  }
}

class FailingItemTest {
  private val r1 = route(ROUTE_A)
  private val r2 = route(ROUTE_B)

  private fun Sessions2.queueRoutes() {
    phoneQueue.queue(r1)
    phoneQueue.queue(r2)
  }

  @Test
  fun aRouteTheWatchCannotStoreNoLongerBlocksTheRouteBehindIt() {
    val s = Sessions2()
    s.queueRoutes()
    s.watchRoutes.failIds += ROUTE_A
    repeat(3) { s.session() }
    // the first item failed three sessions running and is now offered last
    assertTrue(ROUTE_B !in s.watchRoutes.saved)
    s.session()
    assertTrue(ROUTE_B in s.watchRoutes.saved)
    assertEquals(listOf(ROUTE_B to r2.revision), s.phoneQueue.delivered)
    // the item that fails is still queued and still retried, never parked or deleted
    assertTrue(ROUTE_A in s.phoneQueue.queued)
    assertTrue(s.phoneAside.isEmpty())
  }

  @Test
  fun anActivityThePhoneCannotStoreNoLongerBlocksTheOneBehindIt() {
    val s = Sessions2()
    s.outboxQueue.queue(activity(ACT_1))
    s.outboxQueue.queue(activity(ACT_2))
    s.sink.failIds += ACT_1
    repeat(3) { s.session() }
    assertTrue(ACT_2 !in s.sink.stored)
    s.session()
    assertTrue(ACT_2 in s.sink.stored)
    assertTrue(ACT_2 !in s.outboxQueue.queued)
    assertTrue(ACT_1 in s.outboxQueue.queued)
    assertTrue(s.watchAside.isEmpty())
  }

  @Test
  fun aHealthyItemThatTimedOutThreeTimesIsStillDeliveredLater() {
    val s = Sessions2()
    s.queueRoutes()
    repeat(3) { s.session(stall = true) }
    s.session()
    // the radio recovered: the demoted route went after the other, and both arrive
    assertEquals(listOf(ROUTE_B, ROUTE_A), s.phoneQueue.delivered.map { it.first })
    assertTrue(s.phoneQueue.queued.isEmpty())
    assertTrue(s.phoneAside.isEmpty())
  }

  @Test
  fun anOwnItemThatFailsLocallyThreeTimesIsSetAsideNotDeleted() {
    val s = Sessions2()
    s.queueRoutes()
    s.phoneRoutes.failMarkFor += ROUTE_A
    repeat(3) { s.session() }
    assertEquals(listOf(ROUTE_A), s.phoneAside)
    // set aside means out of the queue; the app moves the file, so the queue here forgot it and the ledger let go
    assertFalse(ROUTE_A in s.phoneQueue.queued)
    s.session()
    assertEquals(ROUTE_B, s.phoneQueue.delivered.single().first)
  }

  @Test
  fun anOwnItemThatFailsLocallyTwiceAndIsThenFixedIsKeptAndItsCountsAreReset() {
    val s = Sessions2()
    s.queueRoutes()
    s.phoneRoutes.failMarkFor += ROUTE_A
    repeat(2) { s.session() }
    s.phoneRoutes.failMarkFor.clear()
    s.session()
    assertTrue(s.phoneAside.isEmpty())
    assertEquals(setOf(ROUTE_A, ROUTE_B), s.phoneQueue.delivered.map { it.first }.toSet())
    // the delivery cleared the two failures: a fresh route with the same id needs three new ones
    s.phoneQueue.queue(route(ROUTE_A, gpx = "<gpx>new</gpx>"))
    s.phoneRoutes.failMarkFor += ROUTE_A
    repeat(2) { s.session() }
    assertTrue(s.phoneAside.isEmpty())
    s.session()
    assertEquals(listOf(ROUTE_A), s.phoneAside)
  }

  @Test
  fun anActivityTheWatchCannotDeleteAfterTheConfirmationIsSetAsideOnTheThirdSession() {
    val s = Sessions2()
    s.outboxQueue.queue(activity(ACT_1))
    s.outboxQueue.queue(activity(ACT_2))
    s.outbox.failDeleteFor += ACT_1
    repeat(3) { s.session() }
    assertEquals(listOf(ACT_1), s.watchAside)
    assertTrue(s.watchEnds.all { it.failed == ItemRef(ItemKind.ACTIVITY, ACT_1) && it.inFlight == ItemRef(ItemKind.ACTIVITY, ACT_1) })
    s.session()
    assertTrue(ACT_2 !in s.outboxQueue.queued)
  }

  @Test
  fun countsSurviveARestartOfTheApp() {
    val s = Sessions2()
    s.queueRoutes()
    s.watchRoutes.failIds += ROUTE_A
    repeat(2) { s.session() }
    s.restart()
    s.session()
    s.restart()
    s.session()
    assertTrue(ROUTE_B in s.watchRoutes.saved)
  }

  @Test
  fun aConfirmationLetsTheItemBackToItsPlace() {
    val s = Sessions2()
    s.queueRoutes()
    s.watchRoutes.failIds += ROUTE_A
    repeat(3) { s.session() }
    s.session()
    s.watchRoutes.failIds.clear()
    s.session()
    assertEquals(listOf(ROUTE_B, ROUTE_A), s.phoneQueue.delivered.map { it.first })
  }

  @Test
  fun theReceiverNamesItsOwnFailureAndTheSenderSeesAnUnconfirmedEnd() {
    val s = Sessions2()
    s.phoneQueue.queue(r1)
    s.watchRoutes.failIds += ROUTE_A
    s.session()
    val watchEnd = s.watchEnds.single()
    assertEquals(CloseReason.STORE_FAILED, watchEnd.reason)
    assertEquals(ItemRef(ItemKind.ROUTE, ROUTE_A), watchEnd.failed)
    assertNull(watchEnd.inFlight)
    val phoneEnd = s.phoneEnds.single()
    assertEquals(ItemRef(ItemKind.ROUTE, ROUTE_A), phoneEnd.inFlight)
    assertNull(phoneEnd.failed)
  }
}

class CloseInfoTest {
  @Test
  fun aRouteOfferedAndNotConfirmedIsInFlightWhateverEndsTheSession() {
    for (end in listOf("timeout", "peer", "local", "bad")) {
      val events = InfoEvents()
      val routes = FakePhoneRoutes().also { it.queue(route(ROUTE_A)) }
      val stream = MemoryStream()
      val clock = FakeClock()
      val phone = PhoneEndpoint(stream, clock, routes, FakeSink(), events)
      phone.open()
      phone.feed(Hello(listOf(1)))
      when (end) {
        "timeout" -> {
          clock.now += LinkConfig().confirmTimeoutMs
          phone.tick()
        }
        "peer" -> phone.onClosed()
        "local" -> phone.close()
        else -> phone.onBytes(byteArrayOf(0, 0, 0, 1, 'x'.code.toByte()), 0, 5)
      }
      assertEquals(end, ItemRef(ItemKind.ROUTE, ROUTE_A), events.infos.single().inFlight)
    }
  }

  @Test
  fun aConfirmedItemIsNotInFlightAnyMore() {
    val events = InfoEvents()
    val r = route(ROUTE_A)
    val phone = PhoneEndpoint(MemoryStream(), FakeClock(), FakePhoneRoutes().also { it.queue(r) }, FakeSink(), events)
    phone.open()
    phone.feed(Hello(listOf(1)), RouteSaved(ROUTE_A, r.revision))
    phone.onClosed()
    assertNull(events.infos.single().inFlight)
  }

  @Test
  fun anActivityOfferedByTheWatchIsInFlightOnTheWatchOnly() {
    val watchEvents = InfoEvents()
    val outbox = FakeOutbox().also { it.queue(activity(ACT_1)) }
    val watch = WatchEndpoint(MemoryStream(), FakeClock(), FakeWatchRoutes(), outbox, watchEvents)
    watch.open()
    watch.feed(Hello(listOf(1)))
    watch.onClosed()
    assertEquals(ItemRef(ItemKind.ACTIVITY, ACT_1), watchEvents.infos.single().inFlight)
  }

  @Test
  fun aSinkThatThrowsNamesThePeersItemAndHasNothingInFlight() {
    val events = InfoEvents()
    val sink = FakeSink().also { it.fail = true }
    val phone = PhoneEndpoint(MemoryStream(), FakeClock(), FakePhoneRoutes(), sink, events)
    phone.open()
    phone.feed(Hello(listOf(1)), activity(ACT_1))
    val info = events.infos.single()
    assertEquals(CloseReason.STORE_FAILED, info.reason)
    assertEquals(ItemRef(ItemKind.ACTIVITY, ACT_1), info.failed)
    assertNull(info.inFlight)
  }

  @Test
  fun anUnsendableRouteNamesItsKindAndId() {
    val events = InfoEvents()
    val big = RouteOffer(ROUTE_A, "big", "t", "a".repeat(Framing.MAX_FRAME_BYTES))
    val phone = PhoneEndpoint(MemoryStream(), FakeClock(), FakePhoneRoutes().also { it.queue(big) }, FakeSink(), events)
    phone.open()
    phone.feed(Hello(listOf(1)))
    val info = events.infos.single()
    assertEquals(CloseReason.UNSENDABLE_ITEM, info.reason)
    assertEquals(ItemRef(ItemKind.ROUTE, ROUTE_A), info.failed)
  }

  @Test
  fun anUnsendableActivityNamesItsKindAndId() {
    val events = InfoEvents()
    val outbox = FakeOutbox().also { it.queue(activity(ACT_1, gpx = "a".repeat(Framing.MAX_FRAME_BYTES))) }
    val watch = WatchEndpoint(MemoryStream(), FakeClock(), FakeWatchRoutes(), outbox, events)
    watch.open()
    watch.feed(Hello(listOf(1)))
    val info = events.infos.single()
    assertEquals(CloseReason.UNSENDABLE_ITEM, info.reason)
    assertEquals(ItemRef(ItemKind.ACTIVITY, ACT_1), info.failed)
  }

  @Test
  fun aConfirmedActivityIsNotInFlightOnTheWatchAnyMore() {
    val events = InfoEvents()
    val outbox = FakeOutbox().also { it.queue(activity(ACT_1)) }
    val watch = WatchEndpoint(MemoryStream(), FakeClock(), FakeWatchRoutes(), outbox, events)
    watch.open()
    watch.feed(Hello(listOf(1)), ActivityStored(ACT_1))
    watch.onClosed()
    assertNull(events.infos.single().inFlight)
  }

  @Test
  fun aQueueReadThatThrowsNamesNoItem() {
    val events = InfoEvents()
    val outbox = FakeOutbox().also { it.failNext = true }
    val watch = WatchEndpoint(MemoryStream(), FakeClock(), FakeWatchRoutes(), outbox, events)
    watch.open()
    watch.feed(Hello(listOf(1)))
    val info = events.infos.single()
    assertEquals(CloseReason.STORE_FAILED, info.reason)
    assertNull(info.failed)
    assertNull(info.inFlight)
  }

  @Test
  fun aRouteWhoseWriteFailsIsStillTheItemInFlight() {
    val events = InfoEvents()
    val stream = MemoryStream()
    val phone = PhoneEndpoint(stream, FakeClock(), FakePhoneRoutes().also { it.queue(route(ROUTE_A)) }, FakeSink(), events)
    phone.open()
    stream.failWrites = true
    phone.feed(Hello(listOf(1)))
    val info = events.infos.single()
    assertEquals(CloseReason.WRITE_FAILED, info.reason)
    assertEquals(ItemRef(ItemKind.ROUTE, ROUTE_A), info.inFlight)
  }

  @Test
  fun anActivityWhoseWriteFailsIsStillTheItemInFlight() {
    val events = InfoEvents()
    val stream = MemoryStream()
    val outbox = FakeOutbox().also { it.queue(activity(ACT_1)) }
    val watch = WatchEndpoint(stream, FakeClock(), FakeWatchRoutes(), outbox, events)
    watch.open()
    stream.failWrites = true
    watch.feed(Hello(listOf(1)))
    assertEquals(ItemRef(ItemKind.ACTIVITY, ACT_1), events.infos.single().inFlight)
  }

  @Test
  fun threeFailedWritesDemoteTheItemSoTheOneBehindGoesFirst() {
    val ledger = ItemLedger(MemoryLedgerStore(), ItemKind.ROUTE)
    val queue = FakePhoneRoutes().also { it.queue(route(ROUTE_A)); it.queue(route(ROUTE_B)) }
    repeat(3) {
      val events = InfoEvents()
      val stream = MemoryStream()
      val phone = PhoneEndpoint(stream, FakeClock(), queue, FakeSink(), events)
      phone.open()
      stream.failWrites = true
      phone.feed(Hello(listOf(1)))
      ledger.onClosed(events.infos.single())
    }
    assertEquals(ROUTE_B, ledger.prefer(queue.queued.keys.toList()))
  }

  @Test
  fun aCallerThatImplementsOnlyClosedStillGetsTheFailedItemId() {
    val events = RecordingEvents()
    val sink = FakeSink().also { it.fail = true }
    val phone = PhoneEndpoint(MemoryStream(), FakeClock(), FakePhoneRoutes(), sink, events)
    phone.open()
    phone.feed(Hello(listOf(1)), activity(ACT_1))
    assertEquals(listOf<String?>(ACT_1), events.itemIds)
    assertEquals(listOf(CloseReason.STORE_FAILED), events.closed)
  }
}
