package codes.madera.crossfog.link

import java.lang.management.ManagementFactory
import java.security.MessageDigest
import java.util.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A maximum-size item is read once, not copied a dozen times: the frame-size check does not build the
 * frame, the UTF-8 check keeps no decoded copy, and the revision hash keeps no byte copy.
 */
class ReadMemoryTest {
  private val id = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
  private val routeId = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0002"

  /** Text that exercises every size rule of the encoder: escapes, control characters, two-, three- and four-byte UTF-8. */
  private val tricky = listOf("a", "\"", "\\", "\n", "\r", "\t", "\b", "\u000c", "\u0001", "\u001f", "/", "é", "ü", "€", "߿", "ࠀ", "￿", "😀", "𐀀", "􏿿")

  private fun randomText(random: Random, max: Int): String {
    val out = StringBuilder()
    repeat(1 + random.nextInt(max)) { out.append(tricky[random.nextInt(tricky.size)]) }
    return out.toString()
  }

  @Test
  fun theSizeOfAnOfferIsTheSizeOfItsEncodedFrame() {
    val random = Random(478)
    repeat(300) {
      val route = RouteOffer(routeId, randomText(random, 40), randomText(random, 20), randomText(random, 400))
      assertEquals(Messages.encode(route).size.toLong(), Messages.encodedSize(route))
      val withRoute = ActivityOffer(id, routeId, randomText(random, 20), randomText(random, 400))
      assertEquals(Messages.encode(withRoute).size.toLong(), Messages.encodedSize(withRoute))
      val alone = ActivityOffer(id, null, randomText(random, 20), randomText(random, 400))
      assertEquals(Messages.encode(alone).size.toLong(), Messages.encodedSize(alone))
    }
  }

  @Test
  fun theSizeOfEveryOtherMessageIsTheSizeOfItsEncodedFrame() {
    val messages = listOf(
      Hello(listOf(1)), Hello(listOf(1, 2, 65535)), Ping, RouteSaved(routeId, Revision.of("x")), ActivityStored(id),
      PairRequest(Revision.of("p")), PairAccepted, PairRejected(PairRejection.WRONG_CODE), PairConfirm, PairDone,
    )
    for (m in messages) assertEquals(m.toString(), Messages.encode(m).size.toLong(), Messages.encodedSize(m))
  }

  private fun item(gpx: String) = """{"activityId":"$id","encoderVersion":"1","gpx":${quoted(gpx)}}""".toByteArray(Charsets.UTF_8)

  // The test's own quoting: the escapes of the unit text below, written out by hand.
  private fun quoted(text: String) = "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""

  @Test
  fun anItemWhoseEscapesAndMultibyteTextFillTheCapExactlyIsKeptAndOneByteMoreIsNot() {
    // Each unit is 1 char but 2 (escape), 2, 3 or 4 bytes once framed; the filler is single bytes, so the total can be set to the byte.
    for (unit in listOf("\"", "\n", "é", "€", "😀")) {
      val body = unit.repeat(1000)
      val base = Messages.encode(ActivityOffer(id, null, "1", body)).size
      val fill = Framing.MAX_FRAME_BYTES - base
      val fits = Items.activityOffer(item(body + "a".repeat(fill)))
      assertEquals(unit, Framing.MAX_FRAME_BYTES, Messages.encode(fits).size)
      val e = assertThrows(ProtocolException::class.java) { Items.activityOffer(item(body + "a".repeat(fill + 1))) }
      assertEquals(unit, ProtocolError.FRAME_TOO_LARGE, e.error)
    }
  }

  @Test
  fun theRevisionOfAnyTextIsTheSha256OfItsUtf8Bytes() {
    val random = Random(479)
    fun expected(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    // Long enough to cross the hash's slice boundary (16 Ki chars) at every offset of a four-byte character,
    // and of an unpaired surrogate on either side of it.
    for (pad in 0..4) {
      val head = "a".repeat(16 * 1024 - 2 + pad)
      for (middle in listOf("\ud83d\ude00", "\ud83d", "\ude00", "\ud83dx", "x\ude00", "\ud83d\ud83d", "\ud83d\ud83dx", "\ud83d\ud83d\ude00")) {
        val text = head + middle + "b".repeat(40_000) + "\u00e9\u20ac"
        assertEquals("pad $pad middle ${middle.length}", expected(text), Revision.of(text))
      }
    }
    // Every char three bytes: a slice is then 48 Ki bytes, the most one slice can hold, and any smaller buffer drops the rest of it.
    for (text in listOf("\u20ac".repeat(40_000), "\u0800".repeat(16 * 1024), "\u20ac".repeat(16 * 1024 + 1))) assertEquals(expected(text), Revision.of(text))
    repeat(100) {
      val text = randomText(random, 3000)
      assertEquals(expected(text), Revision.of(text))
    }
    // Nothing to encode: the encoder is never flushed, and the digest is that of no bytes.
    assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", Revision.of(""))
    // An unpaired surrogate is written as "?", as String.toByteArray does.
    for (text in listOf("\ud800", "a\udc00b", "x\ud83d", "\udc00😀")) assertEquals(expected(text), Revision.of(text))
  }

  @Test
  fun aBodyThatIsNotUtf8IsRefusedWhereverTheBadByteIs() {
    fun refused(bytes: ByteArray) =
      assertEquals(ProtocolError.NOT_A_JSON_OBJECT, assertThrows(ProtocolException::class.java) { Messages.parseObject(bytes) }.error)
    val good = """{"a":"${"x".repeat(20_000)}"}""".toByteArray()
    for (at in listOf(5, 8191, 8192, 8193, 16_383, 16_384, good.size - 3)) {
      refused(good.copyOf().also { it[at] = 0xff.toByte() })
    }
    refused(good + byteArrayOf(0xc3.toByte()))
    refused("""{"a":"x"}""".toByteArray().let { it.copyOf(it.size - 2) + byteArrayOf(0xc0.toByte(), 0x80.toByte(), '"'.code.toByte(), '}'.code.toByte()) })
    // A multibyte character that straddles the check's buffer is not refused.
    // The run starts at char 8184 + pad (the prefix is 6 chars), so the pair of 😀 is split by the edge at pad 5 and é or € reaches it at the ends.
    for (pad in 0..8) {
      val n = 8178 + pad
      val text = """{"a":"${"x".repeat(n)}é€😀"}"""
      assertEquals("é€😀".length + n, Messages.parseObject(text.toByteArray()).getString("a").length)
    }
  }

  private fun allocated(block: () -> Unit): Long {
    val mx = ManagementFactory.getThreadMXBean() as com.sun.management.ThreadMXBean
    val tid = Thread.currentThread().id
    repeat(2) { block() }
    System.gc()
    val before = mx.getThreadAllocatedBytes(tid)
    block()
    return mx.getThreadAllocatedBytes(tid) - before
  }

  private fun bigItem(kind: String): ByteArray {
    val unit = "<trkpt lat=\"1\" lon=\"2\"/>"
    val cap = Framing.MAX_FRAME_BYTES
    // A queued route has no revision; a received one always carries it, which is hashed against the gpx when read.
    val shell = if (kind == "activity") {
      """{"activityId":"$id","encoderVersion":"1","gpx":""}"""
    } else {
      """{"routeId":"$routeId","name":"n","createdAt":"2026-01-02T03:04:05Z",@REVISION@"gpx":""}"""
    }
    // The framed form carries an envelope and, for a route, a revision: keep the item under the cap once framed.
    val room = cap - shell.length - 300
    val gpx = StringBuilder(room + unit.length).apply { while (length < room) append(unit) }.toString().replace("\"", "'")
    val revision = if (kind == "route with revision") "\"revision\":\"${Revision.of(gpx)}\"," else ""
    return shell.replace("@REVISION@", revision).replace("\"gpx\":\"\"", "\"gpx\":\"$gpx\"").toByteArray(Charsets.UTF_8)
  }

  @Test
  fun readingAMaximumSizeItemAllocatesAtMostFiveCopiesOfItOnTheJvm() {
    for (kind in listOf("activity", "route", "route with revision")) {
      val bytes = bigItem(kind)
      assertTrue(kind, bytes.size > Framing.MAX_FRAME_BYTES - 1024)
      val bytesAllocated = allocated { if (kind == "activity") Items.activityOffer(bytes) else Items.routeOffer(bytes) }
      val copies = bytesAllocated.toDouble() / bytes.size
      assertTrue("$kind: read allocated ${"%.1f".format(copies)} copies of the item", copies <= MAX_COPIES)
    }
  }

  private companion object {
    // The Maven org.json copies a string through a builder, which Android's does not for text with no escapes: the device test holds the tighter bound.
    const val MAX_COPIES = 5.0
  }
}
