package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** What a staged or queued file holds: an offer's fields with no envelope, as older builds wrote them. */
class ItemsTest {
  private val id = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
  private val route = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0002"

  private fun activity(
    activityId: String? = "\"$id\"",
    routeId: String? = "\"$route\"",
    travelMode: String? = null,
    encoderVersion: String? = "\"1\"",
    gpx: String? = "\"<gpx/>\"",
  ): ByteArray {
    val fields = listOf(
      "activityId" to activityId,
      "routeId" to routeId,
      "travelMode" to travelMode,
      "encoderVersion" to encoderVersion,
      "gpx" to gpx,
    ).filter { it.second != null }
    return fields.joinToString(",", "{", "}") { "\"${it.first}\":${it.second}" }.toByteArray()
  }

  private fun errorOf(block: () -> Unit): ProtocolError = assertThrows(ProtocolException::class.java) { block() }.error

  @Test
  fun parsesAnActivityOffer() {
    assertEquals(ActivityOffer(id, route, "1", "<gpx/>"), Items.activityOffer(activity()))
  }

  @Test
  fun anOfferStagedWithATravelModeStillParses() {
    assertEquals(ActivityOffer(id, route, "1", "<gpx/>"), Items.activityOffer(activity(travelMode = "\"walk\"")))
  }

  @Test
  fun routeIdIsOptional() {
    assertNull(Items.activityOffer(activity(routeId = null)).routeId)
    assertNull(Items.activityOffer(activity(routeId = "null")).routeId)
  }

  @Test
  fun rejectsAnActivityOfferWithABadField() {
    val bad = listOf(
      activity(activityId = null),
      activity(activityId = "\"../x\""),
      activity(activityId = "5"),
      activity(routeId = "\"nope\""),
      activity(encoderVersion = null),
      activity(encoderVersion = "\"${"x".repeat(65)}\""),
      activity(gpx = "\"\""),
      activity(gpx = "12"),
    )
    for (frame in bad) assertEquals(String(frame), ProtocolError.FIELD_MISSING_OR_INVALID, errorOf { Items.activityOffer(frame) })
  }

  @Test
  fun rejectsAnIdThatIsHexShapedButNotAnRfcUuid() {
    val zero = "\"00000000-0000-0000-0000-000000000000\""
    assertEquals(ProtocolError.FIELD_MISSING_OR_INVALID, errorOf { Items.activityOffer(activity(activityId = zero)) })
  }

  @Test
  fun rejectsADeeplyNestedBodyWithoutCrashing() {
    assertEquals(ProtocolError.NESTED_TOO_DEEPLY, errorOf { Items.activityOffer("{\"a\":".repeat(200_000).toByteArray()) })
  }

  @Test
  fun rejectsBodiesThatAreNotJsonObjects() {
    for (text in listOf("", "[]", "null", "{", "plain")) {
      assertEquals(text, ProtocolError.NOT_A_JSON_OBJECT, errorOf { Items.activityOffer(text.toByteArray()) })
    }
  }

  @Test
  fun aParseFailureMessageHoldsNoPartOfTheInput() {
    val secret = "secret-track-content"
    val e = assertThrows(ProtocolException::class.java) { Items.activityOffer("{\"gpx\":\"$secret".toByteArray()) }
    assertFalse(e.message!!.contains(secret))
    assertNull(e.cause)
    val field = assertThrows(ProtocolException::class.java) { Items.activityOffer(activity(activityId = "\"secret-value\"")) }
    assertFalse(field.message!!.contains("secret-value"))
  }

  @Test
  fun rejectsABodyOverTheLimitBeforeParsingIt() {
    val e = assertThrows(ProtocolException::class.java) { Items.activityOffer(ByteArray(Framing.MAX_FRAME_BYTES + 1)) }
    assertEquals("frame is too large", e.message)
  }

  @Test
  fun refusesAnItemThatFitsTheCapBareButNotOnceFramed() {
    val head = activity(gpx = "\"\"").size
    val padded = activity(gpx = "\"${"a".repeat(Framing.MAX_FRAME_BYTES - head - 10)}\"")
    assertEquals(ProtocolError.FRAME_TOO_LARGE, errorOf { Items.activityOffer(padded) })
    val route = """{"routeId":"$route","name":"R","createdAt":"t","gpx":"${"a".repeat(Framing.MAX_FRAME_BYTES - 120)}"}"""
    assertEquals(ProtocolError.FRAME_TOO_LARGE, errorOf { Items.routeOffer(route.toByteArray()) })
  }

  @Test
  fun anItemWhoseFramedFormIsExactlyTheCapIsKeptAndOneByteMoreIsNot() {
    val overhead = Messages.encode(ActivityOffer(id, route, "1", "x")).size - 1
    fun item(gpxChars: Int) = activity(gpx = "\"${"a".repeat(gpxChars)}\"")
    val fits = Items.activityOffer(item(Framing.MAX_FRAME_BYTES - overhead))
    assertEquals(Framing.MAX_FRAME_BYTES, Messages.encode(fits).size)
    assertEquals(ProtocolError.FRAME_TOO_LARGE, errorOf { Items.activityOffer(item(Framing.MAX_FRAME_BYTES - overhead + 1)) })
  }

  @Test
  fun theBareParseAcceptsABodyExactlyAtTheLimit() {
    val head = activity(gpx = "\"\"").size
    val padded = activity(gpx = "\"${"a".repeat(Framing.MAX_FRAME_BYTES - head)}\"")
    assertEquals(Framing.MAX_FRAME_BYTES, padded.size)
    assertEquals(Framing.MAX_FRAME_BYTES - head, Messages.activityOffer(Messages.parseObject(padded)).gpx.length)
  }

  @Test
  fun parsesARouteOfferQueuedBeforeRevisionsExisted() {
    val json = """{"routeId":"$route","name":"Route","createdAt":"2026-10-21T10:00:00Z","gpx":"<gpx/>"}"""
    assertEquals(RouteOffer(route, "Route", "2026-10-21T10:00:00Z", "<gpx/>"), Items.routeOffer(json.toByteArray()))
  }

  @Test
  fun aRouteQueuedWithATravelModeStillParses() {
    val json = """{"routeId":"$route","name":"Route","travelMode":"run","createdAt":"2026-10-21T10:00:00Z","gpx":"<gpx/>"}"""
    assertEquals(RouteOffer(route, "Route", "2026-10-21T10:00:00Z", "<gpx/>"), Items.routeOffer(json.toByteArray()))
  }

  @Test
  fun aRouteOfferWithARevisionMustMatchItsGpx() {
    val ok = """{"routeId":"$route","name":"R","createdAt":"t","gpx":"<gpx/>","revision":"${Revision.of("<gpx/>")}"}"""
    assertEquals(RouteOffer(route, "R", "t", "<gpx/>"), Items.routeOffer(ok.toByteArray()))
    val wrong = ok.replace(Revision.of("<gpx/>"), "0".repeat(64))
    assertEquals(ProtocolError.REVISION_MISMATCH, errorOf { Items.routeOffer(wrong.toByteArray()) })
  }

  @Test
  fun aQueuedRouteWithAMalformedRevisionIsRefusedAndANullOneReadsAsAbsent() {
    val base = """"routeId":"$route","name":"R","createdAt":"t","gpx":"<gpx/>""""
    assertEquals(ProtocolError.FIELD_MISSING_OR_INVALID, errorOf { Items.routeOffer("{$base,\"revision\":\"${Revision.of("<gpx/>").uppercase()}\"}".toByteArray()) })
    assertEquals(RouteOffer(route, "R", "t", "<gpx/>"), Items.routeOffer("{$base,\"revision\":null}".toByteArray()))
  }

  @Test
  fun rejectsARouteOfferWithABadField() {
    val ok = mapOf("routeId" to "\"$route\"", "name" to "\"R\"", "createdAt" to "\"t\"", "gpx" to "\"g\"")
    for ((field, value) in listOf("routeId" to "\"../x\"", "name" to "\"\"", "createdAt" to "null", "gpx" to "\"\"")) {
      val json = (ok + (field to value)).entries.joinToString(",", "{", "}") { "\"${it.key}\":${it.value}" }
      assertEquals(field, ProtocolError.FIELD_MISSING_OR_INVALID, errorOf { Items.routeOffer(json.toByteArray()) })
    }
  }
}
