package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Links that die at the worst moments, and a new session over the same stores. */
class SessionFailureTest {
  private val a = route(ROUTE_A)
  private val act1 = activity(ACT_1, routeId = ROUTE_A)

  /** A new pair of endpoints over the stores of [old], the way a reconnect builds them. */
  private fun again(old: Pair2) =
    Pair2(old.clock, old.phoneRoutes, old.sink, old.watchRoutes, old.outbox, old.config)

  @Test
  fun aLinkThatDropsBeforeTheWatchsHelloLeavesTheRouteQueuedAndTheNextSessionDeliversIt() {
    val first = Pair2()
    first.phoneRoutes.queue(a)
    first.open()
    first.phoneStream.take()
    first.phone.onClosed()
    assertEquals(setOf(ROUTE_A), first.phoneRoutes.queued.keys)
    val second = again(first)
    second.open()
    second.run()
    assertEquals(1, second.watchRoutes.writes)
    assertEquals(listOf(ROUTE_A to a.revision), second.phoneRoutes.delivered)
  }

  @Test
  fun aLinkThatDropsAfterTheWatchStoredTheRouteButBeforeTheConfirmationResendsWithoutStoringTwice() {
    val first = Pair2()
    first.phoneRoutes.queue(a)
    first.open()
    // hellos cross, then the offer reaches the watch
    first.phoneStream.take()
    first.phone.feed(HELLO)
    val offer = first.phoneStream.take()
    first.watch.feed(HELLO)
    first.watch.onBytes(offer, 0, offer.size)
    assertEquals(1, first.watchRoutes.writes)
    // the confirmation is lost with the link
    first.watchStream.take()
    first.phone.onClosed()
    first.watch.onClosed()
    assertTrue(first.phoneRoutes.delivered.isEmpty())
    val second = again(first)
    second.open()
    second.run()
    assertEquals(1, second.watchRoutes.writes)
    assertEquals(listOf(ROUTE_A to a.revision), second.phoneRoutes.delivered)
  }

  @Test
  fun aLinkThatDropsBeforeTheActivityIsConfirmedKeepsItInTheOutbox() {
    val first = Pair2()
    first.outbox.queue(act1)
    first.open()
    first.phoneStream.take()
    first.watchStream.take()
    first.watch.feed(HELLO)
    first.watchStream.take()
    first.watch.onClosed()
    assertTrue(first.outbox.deleted.isEmpty())
    assertEquals(setOf(ACT_1), first.outbox.queued.keys)
  }

  @Test
  fun aLinkThatDropsAfterThePhoneStoredTheActivityButBeforeTheConfirmationResendsWithoutStoringTwice() {
    val first = Pair2()
    first.outbox.queue(act1)
    first.open()
    first.phoneStream.take()
    first.watchStream.take()
    first.watch.feed(HELLO)
    val offer = first.watchStream.take()
    first.phone.feed(HELLO)
    first.phone.onBytes(offer, 0, offer.size)
    assertEquals(1, first.sink.writes)
    first.phoneStream.take()
    first.watch.onClosed()
    first.phone.onClosed()
    assertTrue(first.outbox.deleted.isEmpty())
    val second = again(first)
    second.open()
    second.run()
    assertEquals(1, second.sink.writes)
    assertEquals(listOf(ACT_1), second.outbox.deleted)
    assertTrue(second.outbox.queued.isEmpty())
  }

  @Test
  fun aLinkThatDropsInsideAFrameLeavesNothingStoredAndTheNextSessionDelivers() {
    val first = Pair2()
    first.outbox.queue(act1)
    first.open()
    first.phoneStream.take()
    first.watchStream.take()
    first.watch.feed(HELLO)
    val offer = first.watchStream.take()
    first.phone.feed(HELLO)
    first.phone.onBytes(offer, 0, offer.size - 1)
    first.phone.onClosed()
    assertEquals(listOf(CloseReason.CUT_MID_FRAME), first.phoneEvents.closed)
    assertEquals(0, first.sink.writes)
    val second = again(first)
    second.open()
    second.run()
    assertEquals(1, second.sink.writes)
    assertEquals(listOf(ACT_1), second.outbox.deleted)
  }

  @Test
  fun aSinkThatFailsKeepsTheActivityQueuedUntilItWorks() {
    val first = Pair2()
    first.sink.fail = true
    first.outbox.queue(act1)
    first.open()
    first.run()
    assertEquals(listOf(CloseReason.STORE_FAILED), first.phoneEvents.closed)
    assertTrue(first.outbox.deleted.isEmpty())
    first.sink.fail = false
    val second = again(first)
    second.open()
    second.run()
    assertEquals(listOf(ACT_1), second.outbox.deleted)
  }

  @Test
  fun aWatchStoreThatFailsKeepsTheRouteQueuedOnThePhone() {
    val first = Pair2()
    first.watchRoutes.fail = true
    first.phoneRoutes.queue(a)
    first.open()
    first.run()
    assertEquals(listOf(CloseReason.STORE_FAILED), first.watchEvents.closed)
    assertTrue(first.phoneRoutes.delivered.isEmpty())
    first.watchRoutes.fail = false
    val second = again(first)
    second.open()
    second.run()
    assertEquals(listOf(ROUTE_A to a.revision), second.phoneRoutes.delivered)
  }

  @Test
  fun aPeerThatStopsAnsweringIsLeftByTheTimeoutAndNothingIsLost() {
    val first = Pair2(config = LinkConfig(helloTimeoutMs = 100, confirmTimeoutMs = 1000))
    first.phoneRoutes.queue(a)
    first.outbox.queue(act1)
    first.open()
    first.phoneStream.take()
    first.watchStream.take()
    first.phone.feed(HELLO)
    first.watch.feed(HELLO)
    first.phoneStream.take()
    first.watchStream.take()
    first.clock.now = 1000
    first.phone.tick()
    first.watch.tick()
    assertEquals(listOf(CloseReason.TIMEOUT), first.phoneEvents.closed)
    assertEquals(listOf(CloseReason.TIMEOUT), first.watchEvents.closed)
    assertEquals(setOf(ROUTE_A), first.phoneRoutes.queued.keys)
    assertEquals(setOf(ACT_1), first.outbox.queued.keys)
    val second = again(first)
    second.open()
    second.run()
    assertTrue(second.phoneRoutes.queued.isEmpty() && second.outbox.queued.isEmpty())
  }

  @Test
  fun routesAndActivitiesInSeveralFlowInBothDirectionsAtOnce() {
    val pair = Pair2()
    for (id in listOf(ROUTE_A, ROUTE_B, ROUTE_C)) pair.phoneRoutes.queue(route(id))
    for (id in listOf(ACT_1, ACT_2, ACT_3)) pair.outbox.queue(activity(id))
    pair.open()
    pair.run(chunk = 7)
    assertEquals(3, pair.watchRoutes.writes)
    assertEquals(3, pair.sink.writes)
    assertEquals(3, pair.phoneRoutes.delivered.size)
    assertEquals(3, pair.outbox.deleted.size)
  }
}
