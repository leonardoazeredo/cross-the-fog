package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** `itemRefused`: a receiver that will never take an item for what it holds says so, the session stays open and the sender sets the item aside. */
class ItemRefusedTest {
  private val a = route(ROUTE_A)
  private val b = route(ROUTE_B)

  @Test
  fun theMessageNamesKindIdAndAFixedReason() {
    val m = ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE)
    assertEquals("""{"v":1,"type":"itemRefused","kind":"route","id":"$ROUTE_A","reason":"unreadable"}""", String(Messages.encode(m)))
    assertEquals(m, Messages.parse(Messages.encode(m)))
    assertEquals("ItemRefused", m.toString())
  }

  @Test
  fun aMessageWithAnIdThatIsNoUuidIsNotBuilt() {
    val e = runCatching { ItemRefused(ItemKind.ACTIVITY, "nope", RefusalReason.UNREADABLE) }.exceptionOrNull()
    assertTrue(e is ProtocolException)
  }

  @Test
  fun theWatchRefusesARouteItCannotReadAndStaysOpen() {
    val solo = Solo()
    solo.watchRoutes.refuseIds += ROUTE_A
    val watch = solo.ready(solo.watch())
    watch.feed(a)
    assertEquals(listOf<Message>(ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE)), solo.stream.takeMessages())
    assertTrue("the session stays open", solo.events.closed.isEmpty())
    assertEquals(0, solo.watchRoutes.writes)
    watch.feed(b)
    assertEquals(listOf<Message>(RouteSaved(ROUTE_B, b.revision)), solo.stream.takeMessages())
  }

  @Test
  fun aStoreThatFailsForAnyOtherReasonSendsNoRefusalAndClosesAsBefore() {
    val solo = Solo()
    solo.watchRoutes.fail = true
    val watch = solo.ready(solo.watch())
    watch.feed(a)
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    assertEquals(listOf(CloseReason.STORE_FAILED), solo.events.closed)
  }

  @Test
  fun aSinkThatFailsForAnyOtherReasonSendsNoRefusalAndClosesAsBefore() {
    val solo = Solo()
    solo.sink.fail = true
    val phone = solo.ready(solo.phone())
    phone.feed(activity(ACT_1))
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    assertEquals(listOf(CloseReason.STORE_FAILED), solo.events.closed)
  }

  @Test
  fun thePhoneRefusesAnActivityItCannotReadAndStaysOpen() {
    val solo = Solo()
    solo.sink.refuseIds += ACT_1
    val phone = solo.ready(solo.phone())
    phone.feed(activity(ACT_1))
    assertEquals(listOf<Message>(ItemRefused(ItemKind.ACTIVITY, ACT_1, RefusalReason.UNREADABLE)), solo.stream.takeMessages())
    assertTrue(solo.events.closed.isEmpty())
    phone.feed(activity(ACT_2))
    assertEquals(listOf<Message>(ActivityStored(ACT_2)), solo.stream.takeMessages())
  }

  @Test
  fun aRefusalForTheOfferedRouteIsReportedWithItsRevisionAndTheNextRouteGoesOut() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    solo.phoneRoutes.queue(b)
    solo.events.onRefused = { solo.phoneRoutes.setAside(it.item.id) }
    val phone = solo.ready(solo.phone())
    assertEquals(listOf<Message>(a), solo.pending)
    phone.feed(ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE))
    assertEquals(listOf(Refusal(ItemRef(ItemKind.ROUTE, ROUTE_A), RefusalReason.UNREADABLE, a.revision)), solo.events.refusals)
    assertTrue(solo.events.closed.isEmpty())
    assertEquals(listOf<Message>(b), solo.stream.takeMessages())
    assertEquals(setOf(ROUTE_A), solo.phoneRoutes.setAside.keys)
  }

  @Test
  fun aRefusalEndsTheWaitForAConfirmation() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    solo.events.onRefused = { solo.phoneRoutes.setAside(it.item.id) }
    val phone = solo.ready(solo.phone())
    phone.feed(ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE))
    assertEquals(null, phone.nextDeadline())
    solo.clock.now += solo.config.confirmTimeoutMs * 2
    phone.tick()
    assertTrue(solo.events.closed.isEmpty())
  }

  // The fake queue returns its first entry, so the refused route is what the endpoint finds again: that is the case the guard is for.
  @Test
  fun aRefusedRouteIsNotOfferedAgainInTheSameSessionEvenIfTheAppLeftItQueued() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    phone.feed(ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE))
    phone.wake()
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    assertTrue(solo.events.closed.isEmpty())
  }

  @Test
  fun aNewRevisionOfARefusedRouteIsOfferedInTheSameSession() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    phone.feed(ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE))
    val edited = route(ROUTE_A, "<gpx>edited</gpx>")
    solo.phoneRoutes.queue(edited)
    phone.wake()
    assertEquals(listOf<Message>(edited), solo.stream.takeMessages())
  }

  @Test
  fun aRefusalForARouteNeverOfferedAForAnotherIdOrOfTheWrongKindIsAProtocolViolation() {
    val cases = listOf(
      "nothing offered" to (emptyList<RouteOffer>() to ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE)),
      "another id" to (listOf(a) to ItemRefused(ItemKind.ROUTE, ROUTE_B, RefusalReason.UNREADABLE)),
      "the wrong kind" to (listOf(a) to ItemRefused(ItemKind.ACTIVITY, ROUTE_A, RefusalReason.UNREADABLE)),
    )
    for ((name, case) in cases) {
      val (queued, message) = case
      val solo = Solo()
      queued.forEach { solo.phoneRoutes.queue(it) }
      val phone = solo.ready(solo.phone())
      phone.feed(message)
      assertEquals(name, listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
      assertTrue(name, solo.events.refusals.isEmpty())
    }
  }

  @Test
  fun aSecondRefusalForTheSameRouteIsAProtocolViolation() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    phone.feed(ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE), ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    assertEquals(1, solo.events.refusals.size)
  }

  @Test
  fun aRefusalForTheOfferedActivityIsReportedAndTheNextActivityGoesOut() {
    val solo = Solo()
    solo.outbox.queue(activity(ACT_1))
    solo.outbox.queue(activity(ACT_2))
    solo.events.onRefused = { solo.outbox.setAside(it.item.id) }
    val watch = solo.ready(solo.watch())
    watch.feed(ItemRefused(ItemKind.ACTIVITY, ACT_1, RefusalReason.UNREADABLE))
    assertEquals(listOf(Refusal(ItemRef(ItemKind.ACTIVITY, ACT_1), RefusalReason.UNREADABLE, null)), solo.events.refusals)
    assertEquals(listOf<Message>(activity(ACT_2)), solo.stream.takeMessages())
    assertTrue(solo.events.closed.isEmpty())
    assertTrue("set aside, never deleted", solo.outbox.deleted.isEmpty())
  }

  @Test
  fun theWatchTakesNoRefusalForARouteAndNoRefusalOutsideAReadySession() {
    val solo = Solo()
    solo.outbox.queue(activity(ACT_1))
    val watch = solo.ready(solo.watch())
    watch.feed(ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)

    val early = Solo()
    val fresh = early.watch()
    fresh.open()
    fresh.feed(ItemRefused(ItemKind.ACTIVITY, ACT_1, RefusalReason.UNREADABLE))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), early.events.closed)
  }

  @Test
  fun aRouteTheWatchRefusesIsSetAsideAndTheNextOneIsDeliveredInTheSameSession() {
    val pair = Pair2()
    pair.watchRoutes.refuseIds += ROUTE_A
    pair.phoneRoutes.queue(a)
    pair.phoneRoutes.queue(b)
    val ledger = ItemLedger(MemoryLedgerStore(), ItemKind.ROUTE)
    pair.phoneEvents.onRefused = { r ->
      for (action in ledger.onRefused(r.item)) if (action is LedgerAction.SetAside) pair.phoneRoutes.setAside(action.item.id)
    }
    pair.open()
    pair.run()
    assertEquals(listOf(ROUTE_B to b.revision), pair.phoneRoutes.delivered)
    assertEquals(setOf(ROUTE_A), pair.phoneRoutes.setAside.keys)
    assertEquals(setOf(ROUTE_B), pair.watchRoutes.saved.keys)
    assertTrue(pair.phoneEvents.closed.isEmpty() && pair.watchEvents.closed.isEmpty())
  }

  @Test
  fun anActivityThePhoneRefusesIsSetAsideAndTheNextOneIsStoredInTheSameSession() {
    val pair = Pair2()
    pair.sink.refuseIds += ACT_1
    pair.outbox.queue(activity(ACT_1))
    pair.outbox.queue(activity(ACT_2))
    val ledger = ItemLedger(MemoryLedgerStore(), ItemKind.ACTIVITY)
    pair.watchEvents.onRefused = { r ->
      for (action in ledger.onRefused(r.item)) if (action is LedgerAction.SetAside) pair.outbox.setAside(action.item.id)
    }
    pair.open()
    pair.run()
    assertEquals(setOf(ACT_2), pair.sink.stored.keys)
    assertEquals(listOf(ACT_2), pair.outbox.deleted)
    assertEquals(setOf(ACT_1), pair.outbox.setAside.keys)
    assertTrue(pair.phoneEvents.closed.isEmpty() && pair.watchEvents.closed.isEmpty())
  }

  @Test
  fun theLedgerSetsAsideARefusedOwnItemAtOnceAndForgetsItsCounts() {
    val ledger = ItemLedger(MemoryLedgerStore(), ItemKind.ROUTE)
    ledger.onClosed(CloseInfo(CloseReason.TIMEOUT, null, ItemRef(ItemKind.ROUTE, ROUTE_A)))
    val ref = ItemRef(ItemKind.ROUTE, ROUTE_A)
    assertEquals(listOf<LedgerAction>(LedgerAction.SetAside(ref)), ledger.onRefused(ref))
    // the counts went with it: two more unconfirmed ends are not a third
    ledger.onClosed(CloseInfo(CloseReason.TIMEOUT, null, ref))
    assertEquals(emptyList<LedgerAction>(), ledger.onClosed(CloseInfo(CloseReason.TIMEOUT, null, ref)))
  }

  @Test
  fun theLedgerIgnoresARefusalOfTheOtherKind() {
    val ledger = ItemLedger(MemoryLedgerStore(), ItemKind.ROUTE)
    assertEquals(emptyList<LedgerAction>(), ledger.onRefused(ItemRef(ItemKind.ACTIVITY, ACT_1)))
  }

  @Test
  fun aPairingSessionRefusesTheMessage() {
    val clock = FakeClock()
    val ends = RecordingEvents()
    val watch = WatchPairingEndpoint(MemoryStream(), clock, ends, LinkConfig(), PairingOffer(clock, LinkConfig()), TestKeys.watch.spkiHash(), { TestKeys.phone.spkiHash() }, MemoryPins())
    watch.open()
    watch.feed(Hello(listOf(1)), ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), ends.closed)
  }

  @Test
  fun aRefusalThePhoneSendsLeavesItsOwnOfferedRouteWaitingForItsConfirmation() {
    val solo = Solo()
    solo.sink.refuseIds += ACT_1
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    phone.feed(activity(ACT_1))
    assertEquals(listOf<Message>(ItemRefused(ItemKind.ACTIVITY, ACT_1, RefusalReason.UNREADABLE)), solo.stream.takeMessages())
    assertTrue("the wait for the route's confirmation still runs", phone.nextDeadline() != null)
    phone.feed(RouteSaved(ROUTE_A, a.revision))
    assertEquals(listOf(ROUTE_A to a.revision), solo.phoneRoutes.delivered)
    assertTrue(solo.events.closed.isEmpty())
  }

  @Test
  fun aRefusalTheWatchSendsLeavesItsOwnOfferedActivityWaitingForItsConfirmation() {
    val solo = Solo()
    solo.watchRoutes.refuseIds += ROUTE_A
    solo.outbox.queue(activity(ACT_1))
    val watch = solo.ready(solo.watch())
    watch.feed(a)
    assertEquals(listOf<Message>(ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE)), solo.stream.takeMessages())
    assertTrue(watch.nextDeadline() != null)
    watch.feed(ActivityStored(ACT_1))
    assertEquals(listOf(ACT_1), solo.outbox.deleted)
    assertTrue(solo.events.closed.isEmpty())
  }

  @Test
  fun theWatchTakesARefusalOnlyForTheActivityOutstandingAndOnlyOnce() {
    val cases = listOf(
      "none offered" to emptyList<ActivityOffer>(),
      "another id" to listOf(activity(ACT_2)),
    )
    for ((name, queued) in cases) {
      val solo = Solo()
      queued.forEach { solo.outbox.queue(it) }
      val watch = solo.ready(solo.watch())
      watch.feed(ItemRefused(ItemKind.ACTIVITY, ACT_1, RefusalReason.UNREADABLE))
      assertEquals(name, listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
      assertTrue(name, solo.events.refusals.isEmpty())
    }
    val twice = Solo()
    twice.outbox.queue(activity(ACT_1))
    val watch = twice.ready(twice.watch())
    watch.feed(ItemRefused(ItemKind.ACTIVITY, ACT_1, RefusalReason.UNREADABLE), ItemRefused(ItemKind.ACTIVITY, ACT_1, RefusalReason.UNREADABLE))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), twice.events.closed)
    assertEquals(1, twice.events.refusals.size)
  }

  @Test
  fun aRefusedActivityLeftQueuedIsNotOfferedAgainAndTheConfirmationWaitEnds() {
    val solo = Solo()
    solo.outbox.queue(activity(ACT_1))
    val watch = solo.ready(solo.watch())
    watch.feed(ItemRefused(ItemKind.ACTIVITY, ACT_1, RefusalReason.UNREADABLE))
    watch.wake()
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    assertEquals(null, watch.nextDeadline())
    solo.clock.now += solo.config.confirmTimeoutMs * 2
    watch.tick()
    assertTrue(solo.events.closed.isEmpty())
  }

  @Test
  fun aConfirmationAfterARefusalOfTheSameRouteIsAProtocolViolation() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    phone.feed(ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE), RouteSaved(ROUTE_A, a.revision))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    assertTrue(solo.phoneRoutes.delivered.isEmpty())
  }

  @Test
  fun anAppThatClosesTheSessionInsideTheRefusalCallbackSendsNothingMore() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    solo.phoneRoutes.queue(b)
    val phone = solo.ready(solo.phone())
    solo.events.onRefused = { phone.close() }
    phone.feed(ItemRefused(ItemKind.ROUTE, ROUTE_A, RefusalReason.UNREADABLE))
    assertEquals(listOf(CloseReason.LOCAL), solo.events.closed)
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
  }

  @Test
  fun aLedgerReopenedOverTheSameStoreHasNoCountsForARefusedItem() {
    val store = MemoryLedgerStore()
    val ref = ItemRef(ItemKind.ROUTE, ROUTE_A)
    val first = ItemLedger(store, ItemKind.ROUTE)
    first.onClosed(CloseInfo(CloseReason.TIMEOUT, null, ref))
    first.onClosed(CloseInfo(CloseReason.TIMEOUT, null, ref))
    first.onRefused(ref)
    val second = ItemLedger(store, ItemKind.ROUTE)
    assertEquals(emptyList<LedgerAction>(), second.onClosed(CloseInfo(CloseReason.TIMEOUT, null, ref)))
  }
}
