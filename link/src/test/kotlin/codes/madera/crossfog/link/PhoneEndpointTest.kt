package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneEndpointTest {
  private val a = route(ROUTE_A)

  @Test
  fun aQueuedRouteIsOfferedOnceTheLinkIsReady() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    solo.ready(solo.phone())
    assertEquals(listOf<Message>(a), solo.pending)
    assertEquals(listOf(a.routeId), solo.phoneRoutes.queued.keys.toList())
  }

  @Test
  fun aRouteIsDeliveredOnlyOnASavedWithItsRevision() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    val other = route(ROUTE_A, "<gpx>another</gpx>").revision
    phone.feed(RouteSaved(ROUTE_A, other))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    assertEquals(listOf<String?>(null), solo.events.itemIds)
    assertTrue(solo.phoneRoutes.delivered.isEmpty())
    assertEquals(setOf(ROUTE_A), solo.phoneRoutes.queued.keys)
  }

  @Test
  fun aSavedThenMarksItDeliveredAndTheNextRouteGoesOut() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    solo.phoneRoutes.queue(route(ROUTE_B))
    val phone = solo.ready(solo.phone())
    assertEquals(listOf<Message>(a), solo.pending)
    phone.feed(RouteSaved(ROUTE_A, a.revision))
    assertEquals(listOf(ROUTE_A to a.revision), solo.phoneRoutes.delivered)
    assertEquals(listOf<Message>(route(ROUTE_B)), solo.stream.takeMessages())
    assertTrue(solo.events.closed.isEmpty())
  }

  @Test
  fun onlyOneRouteIsOutstandingAtATime() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    solo.phoneRoutes.queue(route(ROUTE_B))
    val phone = solo.ready(solo.phone())
    phone.wake()
    phone.wake()
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
  }

  @Test
  fun aSavedForARouteNeverOfferedIsRefusedAndNothingChanges() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    solo.phoneRoutes.queue(route(ROUTE_C))
    val phone = solo.ready(solo.phone())
    phone.feed(RouteSaved(ROUTE_C, route(ROUTE_C).revision))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    assertTrue(solo.phoneRoutes.delivered.isEmpty())
    assertEquals(setOf(ROUTE_A, ROUTE_C), solo.phoneRoutes.queued.keys)
  }

  @Test
  fun aSavedForAnotherRouteWithTheRevisionOfTheOutstandingOneIsRefused() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    phone.feed(RouteSaved(ROUTE_C, a.revision))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    assertTrue(solo.phoneRoutes.delivered.isEmpty())
  }

  @Test
  fun aSavedWithNothingOutstandingIsRefused() {
    val solo = Solo()
    val phone = solo.ready(solo.phone())
    phone.feed(RouteSaved(ROUTE_A, a.revision))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
  }

  @Test
  fun aSecondSavedForTheSameOfferIsRefusedAndMarksNothingTwice() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    phone.feed(RouteSaved(ROUTE_A, a.revision))
    phone.feed(RouteSaved(ROUTE_A, a.revision))
    assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    assertEquals(1, solo.phoneRoutes.delivered.size)
  }

  @Test
  fun aSavedForTheEarlierRevisionOfARouteEditedWhileOutstandingMarksTheNewOneNothing() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    val v2 = route(ROUTE_A, "<gpx>edited</gpx>")
    solo.phoneRoutes.queue(v2)
    phone.feed(RouteSaved(ROUTE_A, a.revision))
    assertTrue(solo.phoneRoutes.delivered.isEmpty())
    assertEquals(listOf<Message>(v2), solo.stream.takeMessages())
    phone.feed(RouteSaved(ROUTE_A, v2.revision))
    assertEquals(listOf(ROUTE_A to v2.revision), solo.phoneRoutes.delivered)
  }

  @Test
  fun aRouteQueuedWhileIdleGoesOutOnWake() {
    val solo = Solo()
    val phone = solo.ready(solo.phone())
    solo.phoneRoutes.queue(a)
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    phone.wake()
    assertEquals(listOf<Message>(a), solo.stream.takeMessages())
  }

  @Test
  fun aStoreThatFailsToMarkLeavesTheRouteQueuedAndClosesTheLink() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    solo.phoneRoutes.failMark = true
    val phone = solo.ready(solo.phone())
    phone.feed(RouteSaved(ROUTE_A, a.revision))
    assertEquals(listOf(CloseReason.STORE_FAILED), solo.events.closed)
    assertEquals(listOf<String?>(ROUTE_A), solo.events.itemIds)
    assertEquals(setOf(ROUTE_A), solo.phoneRoutes.queued.keys)
    assertTrue(solo.phoneRoutes.delivered.isEmpty())
  }

  @Test
  fun aStoreThatFailsToReadTheQueueClosesTheLink() {
    val solo = Solo()
    val failing = object : PhoneRouteStore {
      override fun nextQueued(): RouteOffer? = throw IllegalStateException("store failed")
      override fun markDelivered(routeId: String, revision: String) = false
    }
    val phone = PhoneEndpoint(solo.stream, solo.clock, failing, solo.sink, solo.events, solo.config)
    phone.open()
    phone.feed(HELLO)
    assertEquals(listOf(CloseReason.STORE_FAILED), solo.events.closed)
  }

  @Test
  fun theWaitIsRearmedForTheNextRouteAndEndsWhenNothingIsOutstanding() {
    val solo = Solo(LinkConfig(confirmTimeoutMs = 1000))
    solo.phoneRoutes.queue(a)
    solo.phoneRoutes.queue(route(ROUTE_B))
    val phone = solo.ready(solo.phone())
    solo.clock.now = 900
    phone.feed(RouteSaved(ROUTE_A, a.revision))
    assertEquals(listOf<Message>(route(ROUTE_B)), solo.stream.takeMessages())
    assertEquals(1900L, phone.nextDeadline())
    solo.clock.now = 1000
    phone.tick()
    solo.clock.now = 1899
    phone.tick()
    assertTrue(solo.events.closed.isEmpty())
    solo.clock.now = 1900
    phone.tick()
    assertEquals(listOf(CloseReason.TIMEOUT), solo.events.closed)

    val last = Solo(LinkConfig(confirmTimeoutMs = 1000))
    last.phoneRoutes.queue(a)
    val only = last.ready(last.phone())
    only.feed(RouteSaved(ROUTE_A, a.revision))
    assertEquals(null, only.nextDeadline())
    last.clock.now = 5000
    only.tick()
    assertTrue(last.events.closed.isEmpty())
  }

  @Test
  fun aHelloAndAnActivityInOneReadAreBothHandled() {
    val solo = Solo()
    val phone = solo.phone()
    phone.open()
    solo.stream.take()
    val bytes = frame(HELLO) + frame(activity(ACT_1))
    phone.onBytes(bytes, 0, bytes.size)
    assertEquals(1, solo.events.ready)
    assertEquals(setOf(ACT_1), solo.sink.stored.keys)
    assertEquals(listOf<Message>(ActivityStored(ACT_1)), solo.stream.takeMessages())
  }

  @Test
  fun aFrameThatClosesTheLinkDropsTheFramesBehindItInTheSameRead() {
    val solo = Solo()
    val phone = solo.phone()
    phone.open()
    solo.stream.take()
    val bytes = frame(Hello(listOf(2))) + frame(HELLO) + frame(activity(ACT_1))
    phone.onBytes(bytes, 0, bytes.size)
    assertEquals(listOf(CloseReason.NO_COMMON_VERSION), solo.events.closed)
    assertTrue(solo.sink.stored.isEmpty())
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
  }

  @Test
  fun trafficInTheOtherDirectionAndNewlyQueuedRoutesDoNotMoveTheWait() {
    val solo = Solo(LinkConfig(confirmTimeoutMs = 1000))
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    solo.clock.now = 900
    phone.feed(activity(ACT_1))
    assertEquals(listOf<Message>(ActivityStored(ACT_1)), solo.stream.takeMessages())
    solo.phoneRoutes.queue(route(ROUTE_B))
    phone.wake()
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    assertEquals(1000L, phone.nextDeadline())
    solo.clock.now = 1000
    phone.tick()
    assertEquals(listOf(CloseReason.TIMEOUT), solo.events.closed)
  }

  @Test
  fun aSilentWatchTimesOutAndTheRouteStaysQueued() {
    val solo = Solo(LinkConfig(confirmTimeoutMs = 1000))
    solo.phoneRoutes.queue(a)
    val phone = solo.ready(solo.phone())
    assertEquals(1000L, phone.nextDeadline())
    solo.clock.now = 999
    phone.tick()
    assertTrue(solo.events.closed.isEmpty())
    solo.clock.now = 1000
    phone.tick()
    assertEquals(listOf(CloseReason.TIMEOUT), solo.events.closed)
    assertEquals(listOf<String?>(null), solo.events.itemIds)
    assertEquals(setOf(ROUTE_A), solo.phoneRoutes.queued.keys)
  }

  @Test
  fun theWaitForAConfirmationStartsWhenTheWriteReturns() {
    val solo = Solo(LinkConfig(confirmTimeoutMs = 1000))
    solo.phoneRoutes.queue(a)
    val slow = object : ByteStream {
      override fun write(bytes: ByteArray) {
        solo.stream.write(bytes)
        solo.clock.now += 400
      }

      override fun close() = solo.stream.close()
    }
    val phone = PhoneEndpoint(slow, solo.clock, solo.phoneRoutes, solo.sink, solo.events, solo.config)
    phone.open()
    solo.clock.now = 0
    phone.feed(HELLO)
    // two writes (length, then body) of 400 ms each ran before the clock was read
    assertEquals(800L + 1000L, phone.nextDeadline())
  }

  @Test
  fun aRouteOfferOrAnActivityConfirmationFromTheWatchIsRefused() {
    for (message in listOf<Message>(a, ActivityStored(ACT_1))) {
      val solo = Solo()
      val phone = solo.ready(solo.phone())
      phone.feed(message)
      assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    }
  }

  @Test
  fun anActivityIsConfirmedOnlyAfterTheSinkHasIt() {
    val solo = Solo()
    val seenBeforeStore = mutableListOf<List<Message>>()
    val sink = object : ActivitySink {
      override fun store(offer: ActivityOffer): SaveResult {
        seenBeforeStore += solo.stream.takeMessages()
        return solo.sink.store(offer)
      }
    }
    val phone = PhoneEndpoint(solo.stream, solo.clock, solo.phoneRoutes, sink, solo.events, solo.config)
    phone.open()
    phone.feed(HELLO)
    solo.stream.take()
    phone.feed(activity(ACT_1))
    assertEquals(listOf(emptyList<Message>()), seenBeforeStore)
    assertEquals(listOf<Message>(ActivityStored(ACT_1)), solo.stream.takeMessages())
    assertEquals(setOf(ACT_1), solo.sink.stored.keys)
  }

  @Test
  fun aSinkThatThrowsSendsNoConfirmationAndClosesTheLink() {
    val solo = Solo()
    solo.sink.fail = true
    val phone = solo.ready(solo.phone())
    phone.feed(activity(ACT_1))
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    assertEquals(listOf(CloseReason.STORE_FAILED), solo.events.closed)
    assertEquals(listOf<String?>(ACT_1), solo.events.itemIds)
    assertTrue(solo.sink.stored.isEmpty())
  }

  @Test
  fun anActivitySentAgainIsStoredOnceAndConfirmedEachTime() {
    val solo = Solo()
    val phone = solo.ready(solo.phone())
    phone.feed(activity(ACT_1), activity(ACT_1))
    assertEquals(1, solo.sink.writes)
    assertEquals(listOf<Message>(ActivityStored(ACT_1), ActivityStored(ACT_1)), solo.stream.takeMessages())
  }

  @Test
  fun anActivityCutMidFrameIsNeitherStoredNorConfirmed() {
    val solo = Solo()
    val phone = solo.ready(solo.phone())
    val bytes = frame(activity(ACT_1))
    phone.onBytes(bytes, 0, bytes.size - 3)
    phone.onClosed()
    assertEquals(listOf(CloseReason.CUT_MID_FRAME), solo.events.closed)
    assertEquals(0, solo.sink.writes)
    assertEquals(emptyList<Message>(), solo.stream.takeMessages())
  }

  @Test
  fun aFailureToWriteTheActivityConfirmationClosesTheLinkAfterTheActivityWasStored() {
    val solo = Solo()
    val phone = solo.ready(solo.phone())
    solo.stream.failWrites = true
    phone.feed(activity(ACT_1))
    assertEquals(listOf(CloseReason.WRITE_FAILED), solo.events.closed)
    assertEquals(setOf(ACT_1), solo.sink.stored.keys)
  }

  @Test
  fun aWriteThatFailsOnTheOfferLeavesTheRouteQueued() {
    val solo = Solo()
    solo.phoneRoutes.queue(a)
    val phone = solo.phone()
    phone.open()
    solo.stream.take()
    solo.stream.failWrites = true
    phone.feed(HELLO)
    assertEquals(listOf(CloseReason.WRITE_FAILED), solo.events.closed)
    assertEquals(listOf<String?>(null), solo.events.itemIds)
    assertEquals(setOf(ROUTE_A), solo.phoneRoutes.queued.keys)
  }

  @Test
  fun aRouteTooLargeToFrameClosesTheLinkAndStaysQueued() {
    val solo = Solo()
    solo.phoneRoutes.queue(RouteOffer(ROUTE_A, "big", "t", "a".repeat(Framing.MAX_FRAME_BYTES)))
    solo.ready(solo.phone())
    assertEquals(listOf(CloseReason.UNSENDABLE_ITEM), solo.events.closed)
    assertEquals(listOf<String?>(ROUTE_A), solo.events.itemIds)
    assertEquals(setOf(ROUTE_A), solo.phoneRoutes.queued.keys)
  }
}
