package codes.madera.crossfog.link

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.lang.management.ManagementFactory
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class FramingTest {
  private fun errorOf(block: () -> Unit): ProtocolError =
    assertThrows(ProtocolException::class.java) { block() }.error

  private fun prefix(length: Long): ByteArray =
    byteArrayOf((length shr 24).toByte(), (length shr 16).toByte(), (length shr 8).toByte(), length.toByte())

  @Test
  fun theLimitIsSixteenMebibytes() {
    assertEquals(16 * 1024 * 1024, Framing.MAX_FRAME_BYTES)
  }

  @Test
  fun aFrameIsABigEndianLengthThenTheBody() {
    assertArrayEquals(byteArrayOf(0, 0, 0, 3, 'a'.code.toByte(), 'b'.code.toByte(), 'c'.code.toByte()), Framing.encode("abc".toByteArray()))
  }

  @Test
  fun decodeGivesBackWhatEncodeWrote() {
    val body = """{"v":1,"type":"ping"}""".toByteArray()
    assertArrayEquals(body, Framing.decode(Framing.encode(body)))
  }

  @Test
  fun aZeroLengthFrameIsRefusedBothWays() {
    assertEquals(ProtocolError.FRAME_EMPTY, errorOf { Framing.encode(ByteArray(0)) })
    assertEquals(ProtocolError.FRAME_EMPTY, errorOf { Framing.decode(prefix(0)) })
  }

  @Test
  fun aFrameOverTheLimitIsRefusedFromItsLengthAlone() {
    assertEquals(ProtocolError.FRAME_TOO_LARGE, errorOf { Framing.encode(ByteArray(Framing.MAX_FRAME_BYTES + 1)) })
    assertEquals(ProtocolError.FRAME_TOO_LARGE, errorOf { Framing.decode(prefix(Framing.MAX_FRAME_BYTES + 1L)) })
    // A prefix with the top bit set must not read as a negative length.
    assertEquals(ProtocolError.FRAME_TOO_LARGE, errorOf { Framing.decode(prefix(0xFFFFFFFFL)) })
  }

  @Test
  fun theReaderRefusesAnOversizeLengthWithoutReadingTheBody() {
    val input = object : InputStream() {
      var bodyReads = 0
      private val head = ByteArrayInputStream(prefix(Framing.MAX_FRAME_BYTES + 1L))
      override fun read(): Int = head.read().also { if (it < 0) bodyReads++ }
    }
    assertEquals(ProtocolError.FRAME_TOO_LARGE, errorOf { Framing.readFrame(input) })
    assertEquals(0, input.bodyReads)
  }

  @Test
  fun aFrameExactlyAtTheLimitIsAccepted() {
    val body = ByteArray(Framing.MAX_FRAME_BYTES) { 'a'.code.toByte() }
    assertEquals(Framing.MAX_FRAME_BYTES, Framing.decode(Framing.encode(body)).size)
  }

  @Test
  fun aTruncatedFrameIsRefused() {
    val frame = Framing.encode("abcdef".toByteArray())
    assertEquals(ProtocolError.FRAME_TRUNCATED, errorOf { Framing.decode(frame.copyOf(frame.size - 1)) })
    assertEquals(ProtocolError.FRAME_TRUNCATED, errorOf { Framing.decode(frame.copyOf(2)) })
    assertEquals(ProtocolError.FRAME_TRUNCATED, errorOf { Framing.decode(ByteArray(0)) })
    assertEquals(ProtocolError.FRAME_TRUNCATED, errorOf { Framing.readFrame(ByteArrayInputStream(frame.copyOf(frame.size - 1))) })
    assertEquals(ProtocolError.FRAME_TRUNCATED, errorOf { Framing.readFrame(ByteArrayInputStream(frame.copyOf(3))) })
  }

  @Test
  fun bytesAfterTheFrameAreRefused() {
    val frame = Framing.encode("abc".toByteArray())
    assertEquals(ProtocolError.FRAME_TRAILING_BYTES, errorOf { Framing.decode(frame + byteArrayOf(0)) })
  }

  @Test
  fun theReaderReturnsFramesInOrderThenNullAtACleanEnd() {
    val out = ByteArrayOutputStream()
    Framing.writeFrame(out, "one".toByteArray())
    Framing.writeFrame(out, "two".toByteArray())
    val input = ByteArrayInputStream(out.toByteArray())
    assertArrayEquals("one".toByteArray(), Framing.readFrame(input))
    assertArrayEquals("two".toByteArray(), Framing.readFrame(input))
    assertNull(Framing.readFrame(input))
  }

  @Test
  fun theReaderCopesWithAStreamThatGivesOneByteAtATime() {
    val frame = Framing.encode("slow".toByteArray())
    val input = object : InputStream() {
      private var i = 0
      override fun read(): Int = if (i < frame.size) frame[i++].toInt() and 0xFF else -1
      override fun read(b: ByteArray, off: Int, len: Int): Int =
        if (len == 0) 0 else read().let { if (it < 0) -1 else { b[off] = it.toByte(); 1 } }
    }
    assertArrayEquals("slow".toByteArray(), Framing.readFrame(input))
  }

  @Test
  fun writingRefusesWhatReadingWould() {
    val out = ByteArrayOutputStream()
    assertEquals(ProtocolError.FRAME_EMPTY, errorOf { Framing.writeFrame(out, ByteArray(0)) })
    assertEquals(ProtocolError.FRAME_TOO_LARGE, errorOf { Framing.writeFrame(out, ByteArray(Framing.MAX_FRAME_BYTES + 1)) })
    assertEquals(0, out.size())
    assertEquals(ProtocolError.FRAME_EMPTY, errorOf { Framing.readFrame(ByteArrayInputStream(prefix(0))) })
  }

  @Test
  fun aClaimOfTheMaximumFollowedByAFewBytesIsTruncatedWithoutAllocatingTheClaim() {
    val frame = prefix(Framing.MAX_FRAME_BYTES.toLong()) + ByteArray(10) { 1 }
    val mx = ManagementFactory.getThreadMXBean() as com.sun.management.ThreadMXBean
    val thread = Thread.currentThread().id
    repeat(2) { errorOf { Framing.readFrame(ByteArrayInputStream(frame)) } }
    System.gc()
    val before = mx.getThreadAllocatedBytes(thread)
    val error = errorOf { Framing.readFrame(ByteArrayInputStream(frame)) }
    val allocated = mx.getThreadAllocatedBytes(thread) - before

    assertEquals(ProtocolError.FRAME_TRUNCATED, error)
    // A JVM that counts no allocations gives equal readings before and after, so a delta of 0 must fail, not pass.
    assertTrue("allocation counter unavailable", allocated > 0)
    // One 64 KiB chunk and a buffer of the same size: far under the 16 MiB the peer claimed.
    assertTrue("allocated $allocated bytes for a 10-byte frame", allocated < 1024 * 1024)
  }

  @Test
  fun theReaderJoinsABodyLargerThanItsChunk() {
    val big = ByteArray(64 * 1024 + 1) { (it % 251).toByte() }
    val out = ByteArrayOutputStream()
    Framing.writeFrame(out, big)
    Framing.writeFrame(out, "after".toByteArray())
    val input = ByteArrayInputStream(out.toByteArray())
    assertArrayEquals(big, Framing.readFrame(input))
    assertArrayEquals("after".toByteArray(), Framing.readFrame(input))
  }

  @Test
  fun aLargeFrameCutOffAfterItsFirstChunkIsTruncated() {
    val frame = Framing.encode(ByteArray(200 * 1024))
    assertEquals(ProtocolError.FRAME_TRUNCATED, errorOf { Framing.readFrame(ByteArrayInputStream(frame.copyOf(100 * 1024))) })
  }

  @Test
  fun aStreamFrameExactlyAtTheLimitIsRead() {
    val body = ByteArray(Framing.MAX_FRAME_BYTES)
    assertEquals(Framing.MAX_FRAME_BYTES, Framing.readFrame(ByteArrayInputStream(Framing.encode(body)))!!.size)
  }

  @Test
  fun anErrorMessageNamesNoInput() {
    val e = assertThrows(ProtocolException::class.java) { Framing.decode("secret".toByteArray()) }
    assertEquals(false, e.message!!.contains("secret"))
  }
}
