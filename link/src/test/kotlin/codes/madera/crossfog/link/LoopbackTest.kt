package codes.madera.crossfog.link

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The whole path with nothing outside `link/`: pair, send a route, hand an activity back. */
class LoopbackTest {
  @Test
  fun pairThenSendARouteAndHandAnActivityBackWithConfirmation() {
    for (mode in Chunking.entries) loopback(mode)
  }

  private fun loopback(mode: Chunking) {
    val pairing = PairRig()
    pairing.rig.chunking = mode
    pairing.rig.run()
    assertEquals(listOf(CloseReason.PAIRING_COMPLETE), pairing.watch.events.closed)
    assertEquals(listOf(CloseReason.PAIRING_COMPLETE), pairing.phone.events.closed)
    assertArrayEquals(TestKeys.phone.spkiHash(), pairing.watchPins.get())
    assertArrayEquals(TestKeys.watch.spkiHash(), pairing.phonePins.get())

    val session = NormalRig(phonePins = pairing.phonePins, watchPins = pairing.watchPins)
    session.rig.chunking = mode
    val offer = route(ROUTE_A)
    session.phoneRoutes.queue(offer)
    session.outbox.queue(activity(ACT_1))
    session.rig.run()

    assertEquals(offer, session.watchRoutes.saved[ROUTE_A])
    assertEquals(listOf(ROUTE_A to offer.revision), session.phoneRoutes.delivered)
    assertEquals(setOf(ACT_1), session.sink.stored.keys)
    assertTrue(session.outbox.deleted == listOf(ACT_1))
    assertNotNull(session.phone.endpoint)
  }
}
