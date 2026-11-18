package codes.madera.crossfog.link

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
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
  fun anErrorMessageNamesNoInput() {
    val e = assertThrows(ProtocolException::class.java) { Framing.decode("secret".toByteArray()) }
    assertEquals(false, e.message!!.contains("secret"))
  }
}
