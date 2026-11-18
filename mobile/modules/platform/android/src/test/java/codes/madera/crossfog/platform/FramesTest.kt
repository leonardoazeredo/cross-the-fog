package codes.madera.crossfog.platform

import codes.madera.crossfog.link.ActivityOffer
import codes.madera.crossfog.link.Framing
import codes.madera.crossfog.link.RouteOffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** The parsing itself is `link/`'s and is tested there; these cover what this module adds around it. */
class FramesTest {
  private val id = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
  private val route = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0002"

  private fun activity(travelMode: String? = null, routeId: String? = "\"$route\""): ByteArray {
    val fields = listOf("activityId" to "\"$id\"", "routeId" to routeId, "travelMode" to travelMode, "encoderVersion" to "\"1\"", "gpx" to "\"<gpx/>\"")
      .filter { it.second != null }
    return fields.joinToString(",", "{", "}") { "\"${it.first}\":${it.second}" }.toByteArray()
  }

  @Test
  fun readsAStagedActivityOfferThroughLink() {
    assertEquals(ActivityOffer(id, route, "1", "<gpx/>"), Frames.parseActivityOffer(activity()))
  }

  @Test
  fun readsAQueuedRouteOfferThroughLink() {
    val json = """{"routeId":"$route","name":"Route","createdAt":"2026-10-21T10:00:00Z","gpx":"<gpx/>"}"""
    assertEquals(RouteOffer(route, "Route", "2026-10-21T10:00:00Z", "<gpx/>"), Frames.parseRouteOffer(json.toByteArray()))
  }

  @Test
  fun aRefusalIsAFrameExceptionWithLinksFixedMessage() {
    val tooBig = assertThrows(FrameException::class.java) { Frames.parseActivityOffer(ByteArray(Framing.MAX_FRAME_BYTES + 1)) }
    assertEquals("frame is too large", tooBig.message)
    val field = assertThrows(FrameException::class.java) { Frames.parseActivityOffer("""{"activityId":"secret-value"}""".toByteArray()) }
    assertEquals("field activityId is missing or invalid", field.message)
    assertNull(field.cause)
    assertFalse(field.message!!.contains("secret-value"))
    assertThrows(FrameException::class.java) { Frames.parseRouteOffer("[]".toByteArray()) }
  }

  @Test
  fun theSummaryCarriesNoTrackAndOmitsAMissingRouteId() {
    val summary = Frames.parseActivityOffer(activity(routeId = null)).summary()
    assertEquals(setOf("activityId", "encoderVersion"), summary.keys)
    assertFalse(summary.containsKey("gpx"))
  }

  @Test
  fun anOfferStagedWithATravelModeSummarisesWithoutIt() {
    assertFalse(Frames.parseActivityOffer(activity(travelMode = "\"walk\"")).summary().containsKey("travelMode"))
  }
}
