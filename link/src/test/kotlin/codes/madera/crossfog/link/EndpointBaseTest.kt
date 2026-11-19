package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules both ends share: hello first, one version, timeouts, nothing out of turn. */
class EndpointBaseTest {
  private fun each(prepare: (Solo) -> Unit = {}, config: LinkConfig = LinkConfig(), block: (Solo, Endpoint) -> Unit) {
    for (kind in listOf("phone", "watch")) {
      val solo = Solo(config)
      prepare(solo)
      block(solo, if (kind == "phone") solo.phone() else solo.watch())
    }
  }

  private fun queueBoth(solo: Solo) {
    solo.phoneRoutes.queue(route())
    solo.outbox.queue(activity())
  }

  @Test
  fun aRouteAndAnActivityTravelAndAreConfirmedBackToBack() {
    val pair = Pair2()
    pair.phoneRoutes.queue(route(ROUTE_A))
    pair.outbox.queue(activity(ACT_1, routeId = ROUTE_A))
    pair.open()
    val moved = pair.run()
    assertEquals(listOf(HELLO, HELLO), moved.filterIsInstance<Hello>())
    assertEquals(listOf(ROUTE_A), pair.watchRoutes.saved.keys.toList())
    assertEquals(listOf(ACT_1), pair.sink.stored.keys.toList())
    assertEquals(listOf(ROUTE_A to route(ROUTE_A).revision), pair.phoneRoutes.delivered)
    assertEquals(listOf(ACT_1), pair.outbox.deleted)
    assertTrue(pair.phoneRoutes.queued.isEmpty() && pair.outbox.queued.isEmpty())
    assertEquals(1, pair.phoneEvents.ready)
    assertEquals(1, pair.watchEvents.ready)
    assertTrue(pair.phoneEvents.closed.isEmpty() && pair.watchEvents.closed.isEmpty())
  }

  @Test
  fun nothingButOurHelloIsWrittenUntilThePeersHelloArrives() {
    each(::queueBoth) { solo, endpoint ->
      endpoint.open()
      assertEquals(listOf<Message>(HELLO), solo.stream.takeMessages())
      endpoint.wake()
      endpoint.tick()
      assertEquals(emptyList<Message>(), solo.stream.takeMessages())
      assertEquals(0, solo.events.ready)
      endpoint.feed(HELLO)
      assertEquals(1, solo.events.ready)
      assertEquals(1, solo.stream.takeMessages().size)
    }
  }

  @Test
  fun aPeerThatSpeaksOnlyAnotherVersionGetsOurHelloOnceAndTheLinkCloses() {
    each(::queueBoth) { solo, endpoint ->
      endpoint.open()
      endpoint.feed(Hello(listOf(2, 3)))
      assertEquals(listOf<Message>(HELLO), solo.stream.takeMessages())
      assertEquals(listOf(CloseReason.NO_COMMON_VERSION), solo.events.closed)
      assertTrue(solo.stream.closed)
      assertEquals(0, solo.events.ready)
      endpoint.feed(HELLO)
      endpoint.wake()
      assertEquals(emptyList<Message>(), solo.stream.takeMessages())
    }
  }

  @Test
  fun aPeerThatSpeaksOurVersionAmongOthersIsAccepted() {
    each { solo, endpoint ->
      endpoint.open()
      endpoint.feed(Hello(listOf(2, 1, 7)))
      assertEquals(1, solo.events.ready)
    }
  }

  @Test
  fun anythingButAHelloFirstClosesTheLinkAndWritesNothingMore() {
    val first = listOf(Ping, ActivityStored(ACT_1), RouteSaved(ROUTE_A, route().revision), route(), activity())
    for (message in first) {
      each(::queueBoth) { solo, endpoint ->
        endpoint.open()
        solo.stream.take()
        endpoint.feed(message)
        assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
        assertEquals(emptyList<Message>(), solo.stream.takeMessages())
        assertEquals(0, solo.events.ready)
      }
    }
  }

  @Test
  fun aMessageInAnotherVersionBeforeHelloIsRefusedUnread() {
    each { solo, endpoint ->
      endpoint.open()
      val bytes = frameOf("""{"v":2,"type":"hello","versions":[2]}""")
      endpoint.onBytes(bytes, 0, bytes.size)
      assertEquals(listOf(CloseReason.BAD_FRAME), solo.events.closed)
    }
  }

  @Test
  fun aSecondHelloCloses() {
    each { solo, endpoint ->
      solo.ready(endpoint)
      endpoint.feed(HELLO)
      assertEquals(listOf(CloseReason.UNEXPECTED_MESSAGE), solo.events.closed)
    }
  }

  @Test
  fun aPingIsIgnoredAndDoesNotExtendTheWaitForAConfirmation() {
    val solo = Solo(LinkConfig(helloTimeoutMs = 100, confirmTimeoutMs = 1000))
    solo.phoneRoutes.queue(route())
    val phone = solo.ready(solo.phone())
    assertEquals(1, solo.pending.size)
    solo.clock.now = 900
    phone.feed(Ping)
    assertTrue(solo.events.closed.isEmpty())
    solo.clock.now = 1000
    phone.tick()
    assertEquals(listOf(CloseReason.TIMEOUT), solo.events.closed)
  }

  @Test
  fun noHelloInTimeClosesTheLink() {
    each(config = LinkConfig(helloTimeoutMs = 100)) { solo, endpoint ->
      endpoint.open()
      assertEquals(100L, endpoint.nextDeadline())
      solo.clock.now = 99
      endpoint.tick()
      assertTrue(solo.events.closed.isEmpty())
      solo.clock.now = 100
      endpoint.tick()
      assertEquals(listOf(CloseReason.TIMEOUT), solo.events.closed)
      assertNull(endpoint.nextDeadline())
    }
  }

  @Test
  fun aLinkThatIsReadyWithNothingOutstandingHasNoDeadline() {
    each { solo, endpoint ->
      solo.ready(endpoint)
      assertNull(endpoint.nextDeadline())
    }
  }

  @Test
  fun bytesThatAreNotAFrameCloseTheLink() {
    each { solo, endpoint ->
      solo.ready(endpoint)
      endpoint.onBytes(byteArrayOf(0, 0, 0, 0), 0, 4)
      assertEquals(listOf(CloseReason.BAD_FRAME), solo.events.closed)
      assertTrue(solo.stream.closed)
    }
  }

  @Test
  fun aFrameThatIsNotAMessageClosesTheLink() {
    each { solo, endpoint ->
      solo.ready(endpoint)
      val bytes = frameOf("""{"v":1,"type":"nope"}""")
      endpoint.onBytes(bytes, 0, bytes.size)
      assertEquals(listOf(CloseReason.BAD_FRAME), solo.events.closed)
    }
  }

  @Test
  fun nothingIsReadAfterTheLinkClosed() {
    each(::queueBoth) { solo, endpoint ->
      solo.ready(endpoint)
      endpoint.close()
      solo.stream.take()
      endpoint.feed(HELLO, route(), activity())
      endpoint.wake()
      endpoint.onClosed()
      assertEquals(emptyList<Message>(), solo.stream.takeMessages())
      assertEquals(listOf(CloseReason.LOCAL), solo.events.closed)
      assertTrue(endpoint.isClosed)
    }
  }

  @Test
  fun theLinkIsReportedClosedExactlyOnceWhateverHappensAfter() {
    val ways = listOf<Pair<CloseReason, (Endpoint, Solo) -> Unit>>(
      CloseReason.TIMEOUT to { e, s -> s.clock.now = 1_000_000; e.tick() },
      CloseReason.PEER_CLOSED to { e, _ -> e.onClosed() },
      CloseReason.BAD_FRAME to { e, _ -> e.onBytes(ByteArray(4), 0, 4) },
      CloseReason.LOCAL to { e, _ -> e.close() },
    )
    for ((reason, way) in ways) {
      each(config = LinkConfig(helloTimeoutMs = 10, confirmTimeoutMs = 10)) { solo, endpoint ->
        endpoint.open()
        way(endpoint, solo)
        endpoint.close()
        endpoint.tick()
        endpoint.onClosed()
        endpoint.onBytes(ByteArray(4), 0, 4)
        assertEquals(listOf(reason), solo.events.closed)
        assertEquals(1, solo.stream.closeCalls)
      }
    }
  }

  @Test
  fun aStreamThatThrowsOnCloseStillGetsTheLinkReportedClosed() {
    val solo = Solo()
    val stream = object : ByteStream {
      override fun write(bytes: ByteArray) = Unit
      override fun close() = throw IllegalStateException("already gone")
    }
    val phone = PhoneEndpoint(stream, solo.clock, solo.phoneRoutes, solo.sink, solo.events, solo.config)
    phone.open()
    phone.onClosed()
    assertEquals(listOf(CloseReason.PEER_CLOSED), solo.events.closed)
  }

  @Test
  fun aHelloAndTheFirstOfferInOneReadAreBothHandled() {
    val solo = Solo()
    solo.outbox.queue(activity(ACT_1))
    val watch = solo.watch()
    watch.open()
    solo.stream.take()
    val bytes = frame(HELLO) + frame(route(ROUTE_A))
    watch.onBytes(bytes, 0, bytes.size)
    assertEquals(1, solo.events.ready)
    assertEquals(setOf(ROUTE_A), solo.watchRoutes.saved.keys)
    assertEquals(
      listOf<Message>(activity(ACT_1), RouteSaved(ROUTE_A, route(ROUTE_A).revision)),
      solo.stream.takeMessages(),
    )
  }

  @Test
  fun timeoutsMustBePositive() {
    assertFalse(runCatching { LinkConfig(helloTimeoutMs = 0) }.isSuccess)
    assertFalse(runCatching { LinkConfig(confirmTimeoutMs = -1) }.isSuccess)
  }

  @Test
  fun aStreamThatEndsBetweenFramesAndInsideOneAreTold() {
    each { solo, endpoint ->
      solo.ready(endpoint)
      endpoint.onClosed()
      assertEquals(listOf(CloseReason.PEER_CLOSED), solo.events.closed)
    }
    each { solo, endpoint ->
      solo.ready(endpoint)
      val half = frame(Ping).copyOf(6)
      endpoint.onBytes(half, 0, half.size)
      endpoint.onClosed()
      assertEquals(listOf(CloseReason.CUT_MID_FRAME), solo.events.closed)
    }
  }

  @Test
  fun aWriteThatFailsClosesTheLink() {
    each(::queueBoth) { solo, endpoint ->
      endpoint.open()
      solo.stream.take()
      solo.stream.failWrites = true
      endpoint.feed(HELLO)
      assertEquals(listOf(CloseReason.WRITE_FAILED), solo.events.closed)
      assertTrue(solo.stream.closed)
    }
  }

  @Test
  fun aFailureToWriteOurHelloClosesTheLink() {
    each { solo, endpoint ->
      solo.stream.failWrites = true
      endpoint.open()
      assertEquals(listOf(CloseReason.WRITE_FAILED), solo.events.closed)
    }
  }

  @Test
  fun anEndpointOpensOnce() {
    each { _, endpoint ->
      endpoint.open()
      assertFalse(runCatching { endpoint.open() }.isSuccess)
    }
  }

  @Test
  fun bytesBeforeOpenAreACallersBug() {
    each { _, endpoint ->
      assertFalse(runCatching { endpoint.onBytes(ByteArray(1), 0, 1) }.isSuccess)
    }
  }
}
