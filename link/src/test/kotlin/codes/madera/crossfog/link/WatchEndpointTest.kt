package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchEndpointTest {
  private val a = route(ROUTE_A)
  private val act1 = activity(ACT_1)

  @Test
  fun aRouteIsAnsweredWithItsRevisionOnlyAfterTheStoreHasIt() {
    val solo = Solo()
    val seen = mutableListOf<List<Message>>()
    val store = object : WatchRouteStore {
      override fun save(offer: RouteOffer): SaveResult {
        seen += solo.stream.takeMessages()
        return solo.watchRoutes.save(offer)
      }
    }
    val watch = WatchEndpoint(solo.stream, solo.clock, store, solo.outbox, solo.events, solo.config)
    watch.open()
    watch.feed(HELLO)
    solo.stream.take()
    watch.feed(a)
    assertEquals(listOf(emptyList<Message>()), seen)
    assertEquals(listOf<Message>(RouteSaved(ROUTE_A, a.revision)), solo.stream.takeMessages())
    assertEquals(setOf(ROUTE_A), solo.watchRoutes.saved.keys)
  }

  @Test
  fun aStoreThatThrowsSendsNoConfirmationAndClosesTheLink() {
    val solo = Solo()
    solo.watchRoutes.fail = true
    val watch = solo.ready(solo.watch())
    watch.feed(a)
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    assertEquals(listOf(CloseReason.STORE_FAILED), solo.events.closed)
    assertEquals(listOf<String?>(ROUTE_A), solo.events.itemIds)
  }

  @Test
  fun aRouteSentAgainIsStoredOnceAndConfirmedEachTime() {
    val solo = Solo()
    val watch = solo.ready(solo.watch())
    watch.feed(a, a)
    assertEquals(1, solo.watchRoutes.writes)
    assertEquals(
      listOf<Message>(RouteSaved(ROUTE_A, a.revision), RouteSaved(ROUTE_A, a.revision)),
      solo.stream.takeMessages(),
    )
  }

  @Test
  fun aNewRevisionOfARouteReplacesTheOldAndIsConfirmedWithItsOwnRevision() {
    val solo = Solo()
    val watch = solo.ready(solo.watch())
    val v2 = route(ROUTE_A, "<gpx>edited</gpx>")
    watch.feed(a, v2)
    assertEquals(2, solo.watchRoutes.writes)
    assertEquals(v2, solo.watchRoutes.saved[ROUTE_A])
    assertEquals(
      listOf<Message>(RouteSaved(ROUTE_A, a.revision), RouteSaved(ROUTE_A, v2.revision)),
      solo.stream.takeMessages(),
    )
  }

  @Test
  fun aRouteCutMidFrameIsNeitherStoredNorConfirmed() {
    val solo = Solo()
    val watch = solo.ready(solo.watch())
    val bytes = frame(a)
    watch.onBytes(bytes, 0, bytes.size / 2)
    watch.onClosed()
    assertEquals(listOf(CloseReason.CUT_MID_FRAME), solo.events.closed)
    assertEquals(0, solo.watchRoutes.writes)
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
  }

  @Test
  fun aRouteArrivingOneByteAtATimeIsStoredOnce() {
    val pair = Pair2()
    pair.phoneRoutes.queue(a)
    pair.open()
    pair.run(chunk = 1)
    assertEquals(1, pair.watchRoutes.writes)
    assertEquals(1, pair.phoneRoutes.delivered.size)
  }

  @Test
  fun anActivityLeavesTheOutboxOnlyOnItsConfirmation() {
    val solo = Solo()
    solo.outbox.queue(act1)
    val watch = solo.ready(solo.watch())
    assertEquals(listOf<Message>(act1), solo.pending)
    assertTrue(solo.outbox.deleted.isEmpty())
    watch.feed(ActivityStored(ACT_1))
    assertEquals(listOf(ACT_1), solo.outbox.deleted)
    assertTrue(solo.events.closed.isEmpty())
  }

  @Test
  fun onlyOneActivityIsOutstandingAndTheNextGoesOutOnTheConfirmation() {
    val solo = Solo()
    solo.outbox.queue(act1)
    solo.outbox.queue(activity(ACT_2))
    val watch = solo.ready(solo.watch())
    watch.wake()
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    watch.feed(ActivityStored(ACT_1))
    assertEquals(listOf<Message>(activity(ACT_2)), solo.stream.takeMessages())
  }

  @Test
  fun aConfirmationForAnActivityNeverOfferedIsRefusedAndNothingIsDeleted() {
    val solo = Solo()
    solo.outbox.queue(act1)
    solo.outbox.queue(activity(ACT_3))
    val watch = solo.ready(solo.watch())
    watch.feed(ActivityStored(ACT_3))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    assertTrue(solo.outbox.deleted.isEmpty())
    assertEquals(setOf(ACT_1, ACT_3), solo.outbox.queued.keys)
  }

  @Test
  fun aConfirmationWithNothingOutstandingIsRefused() {
    val solo = Solo()
    val watch = solo.ready(solo.watch())
    watch.feed(ActivityStored(ACT_1))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
  }

  @Test
  fun aSecondConfirmationIsRefusedAndDeletesNothingTwice() {
    val solo = Solo()
    solo.outbox.queue(act1)
    val watch = solo.ready(solo.watch())
    watch.feed(ActivityStored(ACT_1), ActivityStored(ACT_1))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    assertEquals(listOf(ACT_1), solo.outbox.deleted)
  }

  @Test
  fun anOutboxThatFailsToDeleteKeepsTheActivityAndClosesTheLink() {
    val solo = Solo()
    solo.outbox.queue(act1)
    solo.outbox.failDelete = true
    val watch = solo.ready(solo.watch())
    watch.feed(ActivityStored(ACT_1))
    assertEquals(listOf(CloseReason.STORE_FAILED), solo.events.closed)
    assertEquals(setOf(ACT_1), solo.outbox.queued.keys)
    assertEquals(listOf<String?>(ACT_1), solo.events.itemIds)
  }

  @Test
  fun anOutboxThatFailsToReadClosesTheLink() {
    val solo = Solo()
    solo.outbox.failNext = true
    solo.ready(solo.watch())
    assertEquals(listOf(CloseReason.STORE_FAILED), solo.events.closed)
  }

  @Test
  fun aRouteConfirmationOrAnActivityOfferFromThePhoneIsRefused() {
    for (message in listOf<Message>(RouteSaved(ROUTE_A, a.revision), act1)) {
      val solo = Solo()
      val watch = solo.ready(solo.watch())
      watch.feed(message)
      assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    }
  }

  @Test
  fun aSilentPhoneTimesOutAndTheActivityStaysQueued() {
    val solo = Solo(LinkConfig(confirmTimeoutMs = 500))
    solo.outbox.queue(act1)
    val watch = solo.ready(solo.watch())
    solo.clock.now = 499
    watch.tick()
    assertTrue(solo.events.closed.isEmpty())
    solo.clock.now = 500
    watch.tick()
    assertEquals(listOf(CloseReason.TIMEOUT), solo.events.closed)
    assertEquals(setOf(ACT_1), solo.outbox.queued.keys)
  }

  @Test
  fun theWaitIsRearmedForTheNextActivityAndEndsWhenNothingIsOutstanding() {
    val solo = Solo(LinkConfig(confirmTimeoutMs = 1000))
    solo.outbox.queue(act1)
    solo.outbox.queue(activity(ACT_2))
    val watch = solo.ready(solo.watch())
    solo.clock.now = 900
    watch.feed(ActivityStored(ACT_1))
    assertEquals(listOf<Message>(activity(ACT_2)), solo.stream.takeMessages())
    assertEquals(1900L, watch.nextDeadline())
    solo.clock.now = 1899
    watch.tick()
    assertTrue(solo.events.closed.isEmpty())
    solo.clock.now = 1900
    watch.tick()
    assertEquals(listOf(CloseReason.TIMEOUT), solo.events.closed)

    val last = Solo(LinkConfig(confirmTimeoutMs = 1000))
    last.outbox.queue(act1)
    val only = last.ready(last.watch())
    only.feed(ActivityStored(ACT_1))
    assertEquals(null, only.nextDeadline())
    last.clock.now = 5000
    only.tick()
    assertTrue(last.events.closed.isEmpty())
  }

  @Test
  fun aRouteArrivingAndNewlyQueuedActivitiesDoNotMoveTheWait() {
    val solo = Solo(LinkConfig(confirmTimeoutMs = 1000))
    solo.outbox.queue(act1)
    val watch = solo.ready(solo.watch())
    solo.clock.now = 900
    watch.feed(a)
    assertEquals(listOf<Message>(RouteSaved(ROUTE_A, a.revision)), solo.stream.takeMessages())
    solo.outbox.queue(activity(ACT_2))
    watch.wake()
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    assertEquals(1000L, watch.nextDeadline())
    solo.clock.now = 1000
    watch.tick()
    assertEquals(listOf(CloseReason.TIMEOUT), solo.events.closed)
  }

  @Test
  fun anActivityTooLargeToFrameClosesTheLinkNamedAndStaysQueued() {
    val solo = Solo()
    solo.outbox.queue(activity(ACT_1, gpx = "a".repeat(Framing.MAX_FRAME_BYTES)))
    solo.ready(solo.watch())
    assertEquals(listOf(CloseReason.UNSENDABLE_ITEM), solo.events.closed)
    assertEquals(listOf<String?>(ACT_1), solo.events.itemIds)
    assertEquals(setOf(ACT_1), solo.outbox.queued.keys)
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
  }

  @Test
  fun anActivityQueuedWhileIdleGoesOutOnWake() {
    val solo = Solo()
    val watch = solo.ready(solo.watch())
    solo.outbox.queue(act1)
    watch.wake()
    assertEquals(listOf<Message>(act1), solo.stream.takeMessages())
  }
}
