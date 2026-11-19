package codes.madera.crossfog.link

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DecoderTest {
  private fun feedAll(decoder: Framing.Decoder, bytes: ByteArray, chunk: Int): List<ByteArray> {
    val frames = mutableListOf<ByteArray>()
    var at = 0
    while (at < bytes.size) {
      val n = minOf(chunk, bytes.size - at)
      decoder.feed(bytes, at, n) { frames += it; true }
      at += n
    }
    return frames
  }

  @Test
  fun framesComeOutWhateverTheChunking() {
    val bytes = Framing.encode("one".toByteArray()) + Framing.encode("second".toByteArray()) + Framing.encode("3".toByteArray())
    for (chunk in listOf(1, 2, 3, 5, 7, 1000)) {
      val frames = feedAll(Framing.Decoder(), bytes, chunk)
      assertEquals("chunk $chunk", listOf("one", "second", "3"), frames.map { String(it) })
    }
  }

  @Test
  fun aPartialFrameIsReportedUntilItCompletes() {
    val decoder = Framing.Decoder()
    assertFalse(decoder.hasPartial())
    val frame = Framing.encode("abcdef".toByteArray())
    decoder.feed(frame, 0, 2) { true }
    assertTrue(decoder.hasPartial())
    decoder.feed(frame, 2, 5) { true }
    assertTrue(decoder.hasPartial())
    decoder.feed(frame, 7, frame.size - 7) { true }
    assertFalse(decoder.hasPartial())
  }

  @Test
  fun anEmptyFrameAndAnOversizeLengthAreRefusedFromTheLengthAlone() {
    val empty = assertThrows(ProtocolException::class.java) { Framing.Decoder().feed(ByteArray(4), 0, 4) { true } }
    assertEquals(ProtocolError.FRAME_EMPTY, empty.error)
    val big = byteArrayOf(0x01, 0x00, 0x00, 0x01)
    val tooLarge = assertThrows(ProtocolException::class.java) { Framing.Decoder().feed(big, 0, 4) { true } }
    assertEquals(ProtocolError.FRAME_TOO_LARGE, tooLarge.error)
    val topBit = byteArrayOf(0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte())
    assertEquals(ProtocolError.FRAME_TOO_LARGE, assertThrows(ProtocolException::class.java) { Framing.Decoder().feed(topBit, 0, 4) { true } }.error)
  }

  @Test
  fun aLengthClaimCostsNoMoreThanWhatArrived() {
    val decoder = Framing.Decoder()
    decoder.feed(byteArrayOf(0x00, 0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte()), 0, 4) { true }
    decoder.feed(ByteArray(10), 0, 10) { true }
    assertTrue(decoder.hasPartial())
    assertTrue("allocated ${decoder.allocatedBytes()}", decoder.allocatedBytes() <= 4 + 2 * 10)
  }

  @Test
  fun theSinkCanStopTheDecodingAndTheRestIsNotRead() {
    val bytes = Framing.encode("a".toByteArray()) + Framing.encode("b".toByteArray())
    val seen = mutableListOf<String>()
    Framing.Decoder().feed(bytes, 0, bytes.size) { seen += String(it); false }
    assertEquals(listOf("a"), seen)
  }

  @Test
  fun aBodyLargerThanOneChunkIsJoined() {
    val body = ByteArray(200 * 1024) { (it % 251).toByte() }
    val frames = feedAll(Framing.Decoder(), Framing.encode(body), 10_000)
    assertEquals(1, frames.size)
    assertArrayEquals(body, frames[0])
  }
}
