package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class MessagesTest {
  private val route = "11111111-1111-4111-8111-111111111111"
  private val activity = "22222222-2222-4222-8222-222222222222"
  private val gpx = """<gpx version="1.1"><trk><trkseg><trkpt lat="1.0" lon="2.0"/></trkseg></trk></gpx>"""
  private val revision = Revision.of(gpx)

  private fun parse(text: String): Message = Messages.parse(text.toByteArray())

  private fun errorOf(text: String): ProtocolError =
    assertThrows(text.take(80), ProtocolException::class.java) { parse(text) }.error

  private fun routeOfferJson(
    v: String? = "1",
    type: String? = "\"routeOffer\"",
    routeId: String? = "\"$route\"",
    name: String? = "\"Round\"",
    createdAt: String? = "\"2026-01-02T03:04:05Z\"",
    revision: String? = "\"${this.revision}\"",
    gpx: String? = "\"${this.gpx.replace("\"", "\\\"")}\"",
  ): String = obj("v" to v, "type" to type, "routeId" to routeId, "name" to name, "createdAt" to createdAt, "revision" to revision, "gpx" to gpx)

  private fun activityOfferJson(
    activityId: String? = "\"$activity\"",
    routeId: String? = "\"$route\"",
    encoderVersion: String? = "\"1\"",
    gpx: String? = "\"<gpx/>\"",
  ): String = obj("v" to "1", "type" to "\"activityOffer\"", "activityId" to activityId, "routeId" to routeId, "encoderVersion" to encoderVersion, "gpx" to gpx)

  private fun obj(vararg fields: Pair<String, String?>): String =
    fields.filter { it.second != null }.joinToString(",", "{", "}") { "\"${it.first}\":${it.second}" }

  @Test
  fun everyMessageTypeParses() {
    assertEquals(Hello(listOf(1)), parse("""{"v":1,"type":"hello","versions":[1]}"""))
    assertEquals(Ping, parse("""{"v":1,"type":"ping"}"""))
    assertEquals(RouteOffer(route, "Round", "2026-01-02T03:04:05Z", gpx), parse(routeOfferJson()))
    assertEquals(RouteSaved(route, revision), parse("""{"v":1,"type":"routeSaved","routeId":"$route","revision":"$revision"}"""))
    assertEquals(ActivityOffer(activity, route, "1", "<gpx/>"), parse(activityOfferJson()))
    assertEquals(ActivityStored(activity), parse("""{"v":1,"type":"activityStored","activityId":"$activity"}"""))
  }

  @Test
  fun encodingWritesFieldsInAFixedOrderAndParsesBack() {
    assertEquals("""{"v":1,"type":"ping"}""", String(Messages.encode(Ping)))
    assertEquals("""{"v":1,"type":"hello","versions":[1]}""", String(Messages.encode(Hello(listOf(1)))))
    assertEquals(
      """{"v":1,"type":"routeSaved","routeId":"$route","revision":"$revision"}""",
      String(Messages.encode(RouteSaved(route, revision))),
    )
    val offers = listOf(
      RouteOffer(route, "Round \"1\"\n", "2026-01-02T03:04:05Z", gpx),
      ActivityOffer(activity, null, "1", "<gpx/>"),
      ActivityOffer(activity, route, "1", "<gpx/>"),
      ActivityStored(activity),
    )
    for (m in offers) assertEquals(m, Messages.parse(Messages.encode(m)))
  }

  @Test
  fun aRouteOfferCarriesTheHashOfItsGpx() {
    assertEquals(revision, RouteOffer(route, "Round", "t", gpx).revision)
    assertEquals(true, String(Messages.encode(RouteOffer(route, "Round", "t", gpx))).contains("\"revision\":\"$revision\""))
  }

  @Test
  fun aRouteOfferWhoseRevisionIsNotTheHashOfItsGpxIsRefused() {
    assertEquals(ProtocolError.REVISION_MISMATCH, errorOf(routeOfferJson(revision = "\"${"0".repeat(64)}\"")))
  }

  @Test
  fun aRevisionThatIsNotSixtyFourLowercaseHexDigitsIsRefused() {
    for (bad in listOf("\"abc\"", "\"${revision.uppercase()}\"", "5", "null")) {
      assertEquals(bad, ProtocolError.FIELD_MISSING_OR_INVALID, errorOf(routeOfferJson(revision = bad)))
    }
    assertEquals(
      ProtocolError.FIELD_MISSING_OR_INVALID,
      errorOf("""{"v":1,"type":"routeSaved","routeId":"$route","revision":"abc"}"""),
    )
  }

  @Test
  fun anUnknownTypeIsRefusedByName() {
    assertEquals(ProtocolError.UNKNOWN_TYPE, errorOf("""{"v":1,"type":"teleport"}"""))
    assertEquals(ProtocolError.UNKNOWN_TYPE, errorOf("""{"v":1,"type":"Ping"}"""))
  }

  @Test
  fun aMessageWithoutAUsableTypeOrVersionIsRefused() {
    for (text in listOf(
      """{"v":1}""", """{"v":1,"type":5}""", """{"v":1,"type":""}""", """{"type":"ping"}""",
      """{"v":"1","type":"ping"}""", """{"v":1.0,"type":"ping"}""", """{"v":true,"type":"ping"}""",
      """{"v":null,"type":"ping"}""", """{"v":99999999999999999999,"type":"ping"}""",
    )) {
      assertEquals(text, ProtocolError.FIELD_MISSING_OR_INVALID, errorOf(text))
    }
  }

  @Test
  fun aNewerVersionIsRefusedAndItsOtherFieldsAreNotRead() {
    assertEquals(ProtocolError.UNSUPPORTED_VERSION, errorOf("""{"v":2,"type":"ping"}"""))
    // A v2 offer may lay its fields out differently; the version alone decides.
    assertEquals(ProtocolError.UNSUPPORTED_VERSION, errorOf("""{"v":2,"type":"routeOffer","routeId":5}"""))
    assertEquals(ProtocolError.UNSUPPORTED_VERSION, errorOf("""{"v":0,"type":"ping"}"""))
    assertEquals(ProtocolError.UNSUPPORTED_VERSION, errorOf("""{"v":-1,"type":"ping"}"""))
  }

  @Test
  fun aHelloIsAlwaysVersionOneAndListsTheVersionsTheSenderSpeaks() {
    assertEquals(Hello(listOf(1, 2, 3)), parse("""{"v":1,"type":"hello","versions":[1,2,3]}"""))
    assertEquals(Hello(listOf(2)), parse("""{"v":1,"type":"hello","versions":[2]}"""))
    assertEquals(ProtocolError.UNSUPPORTED_VERSION, errorOf("""{"v":2,"type":"hello","versions":[2]}"""))
  }

  @Test
  fun aHelloWithBadVersionsIsRefused() {
    val tooMany = (1..17).joinToString(",", "[", "]")
    for (versions in listOf(
      "[]", "null", "5", "\"1\"", "[0]", "[-1]", "[65536]", "[1,1]", "[1.5]", "[\"1\"]", "[null]", "[1,[2]]", tooMany,
    )) {
      assertEquals(versions, ProtocolError.FIELD_MISSING_OR_INVALID, errorOf("""{"v":1,"type":"hello","versions":$versions}"""))
    }
    assertEquals(ProtocolError.FIELD_MISSING_OR_INVALID, errorOf("""{"v":1,"type":"hello"}"""))
    assertEquals(Hello((1..16).toList()), parse("""{"v":1,"type":"hello","versions":${(1..16).joinToString(",", "[", "]")}}"""))
    assertEquals(Hello(listOf(65535)), parse("""{"v":1,"type":"hello","versions":[65535]}"""))
  }

  @Test
  fun aV1EndpointFindsNoCommonVersionWithAV2Hello() {
    assertNull(Protocol.negotiate(listOf(2)))
    assertEquals(ProtocolError.NO_COMMON_VERSION, assertThrows(ProtocolException::class.java) { Protocol.agree(listOf(2, 3)) }.error)
    assertEquals(1, Protocol.agree(listOf(2, 1)))
    assertEquals(1, Protocol.negotiate(listOf(1)))
  }

  @Test
  fun everyFieldIsCheckedForPresenceTypeAndBounds() {
    val long = { n: Int -> "\"${"x".repeat(n)}\"" }
    val bad = listOf(
      routeOfferJson(routeId = null), routeOfferJson(routeId = "\"../x\""), routeOfferJson(routeId = "5"),
      routeOfferJson(name = null), routeOfferJson(name = "\"\""), routeOfferJson(name = long(256)),
      routeOfferJson(createdAt = null), routeOfferJson(createdAt = "null"), routeOfferJson(createdAt = long(65)),
      routeOfferJson(gpx = null), routeOfferJson(gpx = "\"\""), routeOfferJson(gpx = "12"),
      activityOfferJson(activityId = null), activityOfferJson(activityId = "\"../x\""), activityOfferJson(activityId = "5"),
      activityOfferJson(routeId = "\"nope\""), activityOfferJson(encoderVersion = null), activityOfferJson(encoderVersion = long(65)),
      activityOfferJson(gpx = "\"\""), activityOfferJson(gpx = "12"),
      """{"v":1,"type":"routeSaved","routeId":"$route"}""",
      """{"v":1,"type":"routeSaved","revision":"$revision"}""",
      """{"v":1,"type":"activityStored"}""",
      """{"v":1,"type":"activityStored","activityId":"nope"}""",
    )
    for (text in bad) assertEquals(text.take(100), ProtocolError.FIELD_MISSING_OR_INVALID, errorOf(text))
  }

  @Test
  fun theLongestAllowedTextsAreAccepted() {
    val name = "n".repeat(255)
    val offer = parse(routeOfferJson(name = "\"$name\"", createdAt = "\"${"t".repeat(64)}\""))
    assertEquals(name, (offer as RouteOffer).name)
    assertEquals("e".repeat(64), (parse(activityOfferJson(encoderVersion = "\"${"e".repeat(64)}\"")) as ActivityOffer).encoderVersion)
  }

  @Test
  fun anIdThatIsHexShapedButNotAnRfcUuidIsRefused() {
    val zero = "\"00000000-0000-0000-0000-000000000000\""
    assertEquals(ProtocolError.FIELD_MISSING_OR_INVALID, errorOf(activityOfferJson(activityId = zero)))
  }

  @Test
  fun anActivityOfferNeedsNoRouteId() {
    assertNull((parse(activityOfferJson(routeId = null)) as ActivityOffer).routeId)
    assertNull((parse(activityOfferJson(routeId = "null")) as ActivityOffer).routeId)
  }

  @Test
  fun unknownFieldsAreIgnored() {
    val m = parse("""{"v":1,"type":"activityStored","activityId":"$activity","note":"x","extra":[1,2]}""")
    assertEquals(ActivityStored(activity), m)
  }

  // org.json on Android accepts all of these; the strict check in front of it must not.
  @Test
  fun syntaxOnlyALooseParserAcceptsIsRefused() {
    for (text in listOf(
      "{\"v\":1,\"type\":\"ping\"}\u0000junk{", """{"v":1,"type":"ping"}//x""", """{"v":1,"type":"ping"}#x""", """{"v":1,"type":"ping"}/*x*/""",
      """{"v":1,"type":"ping"/*x*/}""", "{\"v\":1,\"type\":\"ping\"\n# x\n}",
      """{"v":0x1,"type":"ping"}""", """{"v":01,"type":"ping"}""", """{"v":+1,"type":"ping"}""", """{"v":1.,"type":"ping"}""",
      """{"v":1,"type":"ping",}""", """{v:1,"type":"ping"}""", """{'v':1,'type':'ping'}""", """{"v":1;"type":"ping"}""",
      """{"v":1,"type":"ping","type":"routeOffer"}""", """{"v":1,"v":2,"type":"ping"}""",
      """{"v":1,"type":"pi\ng"}""".replace("\\n", "\\x"), "{\"v\":1,\"type\":\"pi\u0001ng\"}", """{"v":1,"type":"ping","a":NaN}""",
      """{"v":1,"type":"ping","a":[1,]}""", """{"v":1,"type":"ping","a":tru}""",
    )) {
      assertEquals(text, ProtocolError.NOT_A_JSON_OBJECT, errorOf(text))
    }
  }

  @Test
  fun aUnicodeEscapeTakesAsciiHexDigitsOnly() {
    assertEquals(ProtocolError.NOT_A_JSON_OBJECT, errorOf("{\"v\":1,\"type\":\"p\\u\u0660\u0660\u0666\u0669ng\"}"))
    assertEquals(ProtocolError.NOT_A_JSON_OBJECT, errorOf("{\"v\":1,\"type\":\"p\\u\uFF10\uFF10\uFF16\uFF19ng\"}"))
    assertEquals(Ping, parse("{\"v\":1,\"type\":\"p\\u0069ng\"}"))
    assertEquals(Ping, parse("{\"v\":1,\"type\":\"p\\u0069ng\"}".replace("0069", "0069")))
  }

  @Test
  fun unicodeEscapesAcceptHexLettersOfEitherCase() {
    // \u00e9 and \u00E9 are both "é"; the same key written both ways is a duplicate.
    assertEquals(Ping, parse("{\"v\":1,\"type\":\"ping\",\"x\":\"\\u00e9\\u00E9\\uabcd\\uABCD\"}"))
    assertEquals(ProtocolError.NOT_A_JSON_OBJECT, errorOf("{\"v\":1,\"type\":\"ping\",\"\\u004a\":1,\"\\u004A\":2}"))
    assertEquals(ProtocolError.NOT_A_JSON_OBJECT, errorOf("{\"v\":1,\"type\":\"ping\",\"\\u00g0\":1}"))
  }

  @Test
  fun escapedSurrogatesMustPair() {
    val pair = "\\ud83d\\ude00"
    assertEquals(Ping, parse("{\"v\":1,\"type\":\"ping\",\"x\":\"$pair\"}"))
    for (bad in listOf("\\ud800", "\\udc00", "\\ude00\\ud83d", "\\ud83dx", "\\ud83d\\n", "\\ud83d\\u0041", "\\ud83d\\ud83d\\ude00")) {
      assertEquals(bad, ProtocolError.NOT_A_JSON_OBJECT, errorOf("{\"v\":1,\"type\":\"ping\",\"x\":\"$bad\"}"))
    }
  }

  @Test
  fun truncatedAndBadEscapesAreRefused() {
    for (bad in listOf("\\u12", "\\u12g4", "\\u", "\\", "\\U0041", "\\x", "\\ ")) {
      assertEquals(bad, ProtocolError.NOT_A_JSON_OBJECT, errorOf("{\"v\":1,\"type\":\"ping\",\"x\":\"$bad\"}"))
      assertEquals(bad, ProtocolError.NOT_A_JSON_OBJECT, errorOf("{\"v\":1,\"type\":\"ping\",\"x\":\"$bad"))
    }
  }

  @Test
  fun malformedNumbersAndSpaceAreRefused() {
    for (n in listOf("-", "1e", "1e+", ".5", "-01", "Infinity", "-Infinity", "True", "1.e3", "100000000000000000000e300", "-${"9".repeat(64)}")) {
      assertEquals(n, ProtocolError.NOT_A_JSON_OBJECT, errorOf("""{"v":1,"type":"ping","x":$n}"""))
    }
    for (space in listOf("\uFEFF", "\u00A0", "\u000b", "\u000c", "\u2003")) {
      assertEquals(space, ProtocolError.NOT_A_JSON_OBJECT, errorOf("""$space{"v":1,"type":"ping"}"""))
      assertEquals(space, ProtocolError.NOT_A_JSON_OBJECT, errorOf("""{"v":1,$space"type":"ping"}"""))
    }
    assertEquals(Ping, parse("""{"v":1,"type":"ping","x":1e0300}""".replace("1e0300", "1e300")))
  }

  @Test
  fun versionsPastIntRangeAreNotWrapped() {
    assertEquals(ProtocolError.UNSUPPORTED_VERSION, errorOf("""{"v":4294967297,"type":"ping"}"""))
    assertEquals(ProtocolError.FIELD_MISSING_OR_INVALID, errorOf("""{"v":1,"type":"hello","versions":[4294967297]}"""))
  }

  @Test
  fun theNestingCapCountsAScalarLeafAndAASameNameAtTwoLevelsIsNotADuplicate() {
    assertEquals(Ping, parse("""{"v":1,"type":"ping","a":{"b":{"c":{"d":{"e":{"f":1}}}}}}"""))
    assertEquals(ProtocolError.NESTED_TOO_DEEPLY, errorOf("""{"v":1,"type":"ping","a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":1}}}}}}}}"""))
    assertEquals(Ping, parse("""{"v":1,"type":"ping","x":{"v":2,"type":"x"}}"""))
    assertEquals(ProtocolError.NOT_A_JSON_OBJECT, errorOf("""{"v":1,"type":"ping","x":{"a":1,"a":2}}"""))
  }

  @Test
  fun bytesThatAreNotUtf8AreRefusedNotRepaired() {
    val head = """{"v":1,"type":"activityOffer","activityId":"$activity","encoderVersion":"1","gpx":"<gpx/>"""
    val tail = "\"}".toByteArray()
    for (bad in listOf(byteArrayOf(0xFF.toByte()), byteArrayOf(0xC3.toByte()), byteArrayOf(0xC0.toByte(), 0x80.toByte()),
      byteArrayOf(0xED.toByte(), 0xA0.toByte(), 0x80.toByte()))) {
      val e = assertThrows(ProtocolException::class.java) { Messages.parse(head.toByteArray() + bad + tail) }
      assertEquals(ProtocolError.NOT_A_JSON_OBJECT, e.error)
    }
  }

  @Test
  fun aNumberPastDoubleRangeIsRefusedLikeAndroidDoes() {
    for (n in listOf("1e400", "1E+999", "9".repeat(70), "1.${"0".repeat(70)}")) {
      assertEquals(n, ProtocolError.NOT_A_JSON_OBJECT, errorOf("""{"v":1,"type":"ping","x":$n}"""))
    }
    assertEquals(Ping, parse("""{"v":1,"type":"ping","x":1e300,"y":-0.5E-300,"z":0}"""))
  }

  @Test
  fun nestingIsRefusedOnePastTheCapAndAcceptedAtIt() {
    fun nested(depth: Int) = """{"v":1,"type":"ping","x":${"[".repeat(depth)}${"]".repeat(depth)}}"""
    assertEquals(Ping, parse(nested(StrictJson.MAX_DEPTH - 1)))
    assertEquals(ProtocolError.NESTED_TOO_DEEPLY, errorOf(nested(StrictJson.MAX_DEPTH)))
  }

  @Test
  fun duplicateKeysAreJudgedOnTheirDecodedText() {
    assertEquals(ProtocolError.NOT_A_JSON_OBJECT, errorOf("""{"v":1,"type":"ping","\u0074ype":"x"}"""))
  }

  @Test
  fun whitespaceAndEscapesJsonAllowsAreAccepted() {
    assertEquals(Ping, parse(" \t\r\n{ \"v\" : 1 ,\"type\":\"p\\u0069ng\" , \"x\":[1, -2.5e+3, true, false, null, {}] }\n"))
  }

  @Test
  fun aFrameThatIsNotAJsonObjectIsRefused() {
    for (text in listOf("", "[]", "null", "{", "plain", "\"x\"", "5")) {
      assertEquals(text, ProtocolError.NOT_A_JSON_OBJECT, errorOf(text))
    }
  }

  @Test
  fun aDeeplyNestedFrameIsRefusedByNameWithoutCrashing() {
    assertEquals(ProtocolError.NESTED_TOO_DEEPLY, errorOf("{\"a\":".repeat(200_000)))
    assertEquals(ProtocolError.NESTED_TOO_DEEPLY, errorOf("""{"v":1,"type":"ping","x":${"[".repeat(50)}${"]".repeat(50)}}"""))
  }

  @Test
  fun textAfterTheObjectIsRefused() {
    for (tail in listOf("{", "x", "{}", ",", "[]")) {
      assertEquals(tail, ProtocolError.NOT_A_JSON_OBJECT, errorOf("""{"v":1,"type":"ping"}$tail"""))
    }
    assertEquals(Ping, parse("{\"v\":1,\"type\":\"ping\"}  \n"))
  }

  @Test
  fun aBodyOverTheLimitIsRefusedBeforeParsing() {
    val e = assertThrows(ProtocolException::class.java) { Messages.parse(ByteArray(Framing.MAX_FRAME_BYTES + 1)) }
    assertEquals(ProtocolError.FRAME_TOO_LARGE, e.error)
    assertEquals("frame is too large", e.message)
  }

  @Test
  fun anErrorMessageHoldsNoPartOfTheInput() {
    val secret = "secret-value"
    for (text in listOf(
      """{"v":1,"type":"$secret"}""", """{"gpx":"$secret""", activityOfferJson(activityId = "\"$secret\""),
      """{"v":1,"type":"ping","x":"$secret"}{""",
    )) {
      val e = assertThrows(ProtocolException::class.java) { parse(text) }
      assertFalse(e.message!!, e.message!!.contains(secret))
      assertNull(e.cause)
    }
  }

  @Test
  fun textThatNeedsEscapingSurvivesTheWire() {
    val tricky = "a\\b \"q\" \t\u0001\u001f \n\r \u000c\b é \uD83D\uDE00 </x> /"
    val offer = RouteOffer(route, tricky, "t", tricky)
    val bytes = Messages.encode(offer)
    assertEquals(offer, Messages.parse(bytes))
    val text = String(bytes, Charsets.UTF_8)
    assertEquals(false, text.any { it < ' ' })
    assertEquals(true, text.contains("\\\\b") && text.contains("\\u0001") && text.contains("\\u001f") && text.contains("\\t"))
  }

  @Test
  fun aMessageCannotBeBuiltWithABadFieldBecauseTheEncoderWritesIdsAsTheyAre() {
    val bad = listOf<() -> Message>(
      { RouteOffer("x\",\"type\":\"ping", "n", "t", "g") }, { RouteOffer(route, "", "t", "g") },
      { RouteOffer(route, "n", "", "g") }, { RouteOffer(route, "n", "t", "") },
      { ActivityOffer(activity, "nope", "1", "g") }, { ActivityOffer(activity, null, "", "g") },
      { ActivityOffer("../x", null, "1", "g") }, { ActivityOffer(activity, null, "1", "") },
      { RouteSaved(route, revision.uppercase()) }, { RouteSaved("nope", revision) },
      { ActivityStored("../x") }, { Hello(listOf()) }, { Hello(listOf(0)) }, { Hello(listOf(1, 1)) },
      { Hello(listOf(65536)) }, { Hello((1..17).toList()) },
    )
    for ((n, build) in bad.withIndex()) {
      assertEquals("case $n", ProtocolError.FIELD_MISSING_OR_INVALID, assertThrows(ProtocolException::class.java) { build() }.error)
    }
  }

  @Test
  fun textWithAnUnpairedSurrogateIsRefusedWhereverItEntersAMessage() {
    for (bad in listOf("a\uD800", "\uDC00a", "\uDE00\uD83D", "\uD83D")) {
      for (build in listOf<() -> Message>(
        { RouteOffer(route, bad, "t", "g") }, { RouteOffer(route, "n", bad, "g") }, { RouteOffer(route, "n", "t", bad) },
        { ActivityOffer(activity, null, bad, "g") }, { ActivityOffer(activity, null, "1", bad) },
      )) {
        assertEquals(ProtocolError.FIELD_MISSING_OR_INVALID, assertThrows(ProtocolException::class.java) { build() }.error)
      }
    }
    val emoji = "\uD83D\uDE00"
    assertEquals(RouteOffer(route, emoji, "t", emoji), Messages.parse(Messages.encode(RouteOffer(route, emoji, "t", emoji))))
  }

  @Test
  fun toStringNamesNoContent() {
    val offer = parse(activityOfferJson(gpx = "\"secret-track\""))
    assertFalse(offer.toString().contains("secret"))
    assertFalse(offer.toString().contains(activity))
    assertFalse(RouteOffer(route, "Private name", "t", "secret-track").toString().contains("secret"))
    assertFalse(RouteOffer(route, "Private name", "t", "g").toString().contains("Private"))
  }
}
