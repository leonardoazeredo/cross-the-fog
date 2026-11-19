package codes.madera.crossfog.link

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * One frame is a 4-byte big-endian length, then that many bytes of body. The length is checked
 * against [MAX_FRAME_BYTES] before any body byte is read or allocated for, so a peer that claims a
 * huge frame costs four bytes of reading. A zero-length frame is refused: nothing sends one.
 */
object Framing {
  const val MAX_FRAME_BYTES = 16 * 1024 * 1024
  const val PREFIX_BYTES = 4

  private const val CHUNK_BYTES = 64 * 1024

  fun encode(body: ByteArray): ByteArray {
    val frame = ByteArray(PREFIX_BYTES + body.size)
    prefix(body.size).copyInto(frame)
    System.arraycopy(body, 0, frame, PREFIX_BYTES, body.size)
    return frame
  }

  fun writeFrame(out: OutputStream, body: ByteArray) {
    out.write(prefix(body.size))
    out.write(body)
  }

  /** The 4 length bytes for a body of [length] bytes, so a sender can write prefix and body without joining them into a third array. */
  fun prefix(length: Int): ByteArray {
    checkLength(length.toLong())
    return ByteArray(PREFIX_BYTES).also { writeLength(it, length) }
  }

  /**
   * Cuts frames out of bytes that arrive in pieces of any size. Each finished body goes to the
   * callback; the callback returns false to stop (the rest of the bytes are dropped). A body array
   * is allocated only as bytes arrive, doubling up to the claimed length, so a peer that claims
   * 16 MiB and sends nothing costs a few bytes and one that sends the whole frame costs exactly the
   * frame. A refused length throws [ProtocolException] and leaves the decoder refusing the same.
   */
  class Decoder {
    private val head = ByteArray(PREFIX_BYTES)
    private var headLength = 0
    private var inBody = false
    private var want = 0
    private var body = ByteArray(0)
    private var bodyLength = 0

    fun hasPartial(): Boolean = headLength > 0 || inBody

    /** Bytes held for the frame in progress, allocated rather than arrived. */
    fun allocatedBytes(): Int = headLength + body.size

    fun feed(bytes: ByteArray, offset: Int, length: Int, onFrame: (ByteArray) -> Boolean) {
      var at = offset
      val end = offset + length
      while (at < end) {
        if (!inBody) {
          val n = minOf(PREFIX_BYTES - headLength, end - at)
          System.arraycopy(bytes, at, head, headLength, n)
          headLength += n
          at += n
          if (headLength < PREFIX_BYTES) return
          val claimed = lengthOf(head)
          checkLength(claimed)
          want = claimed.toInt()
          inBody = true
          bodyLength = 0
          body = ByteArray(0)
        } else {
          val n = minOf(want - bodyLength, end - at)
          if (body.size < bodyLength + n) body = body.copyOf(minOf(want, maxOf(bodyLength + n, body.size * 2)))
          System.arraycopy(bytes, at, body, bodyLength, n)
          bodyLength += n
          at += n
          if (bodyLength == want) {
            val frame = body
            body = ByteArray(0)
            bodyLength = 0
            inBody = false
            headLength = 0
            if (!onFrame(frame)) return
          }
        }
      }
    }
  }

  /** The body of [frame], which must be exactly one frame. */
  fun decode(frame: ByteArray): ByteArray {
    if (frame.size < PREFIX_BYTES) throw ProtocolException(ProtocolError.FRAME_TRUNCATED)
    val length = lengthOf(frame)
    checkLength(length)
    val end = PREFIX_BYTES + length
    if (frame.size < end) throw ProtocolException(ProtocolError.FRAME_TRUNCATED)
    if (frame.size > end) throw ProtocolException(ProtocolError.FRAME_TRAILING_BYTES)
    return frame.copyOfRange(PREFIX_BYTES, frame.size)
  }

  /** The next frame's body, or null when the stream ends cleanly before a frame starts. */
  fun readFrame(input: InputStream): ByteArray? {
    val head = ByteArray(PREFIX_BYTES)
    val got = readUpTo(input, head, PREFIX_BYTES)
    if (got == 0) return null
    if (got < PREFIX_BYTES) throw ProtocolException(ProtocolError.FRAME_TRUNCATED)
    val length = lengthOf(head)
    checkLength(length)
    // Grown a chunk at a time: the length is the peer's claim, not yet bytes that arrived.
    val body = ByteArrayOutputStream(minOf(length, CHUNK_BYTES.toLong()).toInt())
    val chunk = ByteArray(CHUNK_BYTES)
    var remaining = length.toInt()
    while (remaining > 0) {
      val got2 = readUpTo(input, chunk, minOf(remaining, CHUNK_BYTES))
      if (got2 == 0) throw ProtocolException(ProtocolError.FRAME_TRUNCATED)
      body.write(chunk, 0, got2)
      remaining -= got2
    }
    return body.toByteArray()
  }

  private fun checkLength(length: Long) {
    if (length == 0L) throw ProtocolException(ProtocolError.FRAME_EMPTY)
    if (length > MAX_FRAME_BYTES) throw ProtocolException(ProtocolError.FRAME_TOO_LARGE)
  }

  private fun lengthOf(bytes: ByteArray): Long =
    ((bytes[0].toLong() and 0xFF) shl 24) or ((bytes[1].toLong() and 0xFF) shl 16) or
      ((bytes[2].toLong() and 0xFF) shl 8) or (bytes[3].toLong() and 0xFF)

  private fun writeLength(into: ByteArray, length: Int) {
    into[0] = (length ushr 24).toByte()
    into[1] = (length ushr 16).toByte()
    into[2] = (length ushr 8).toByte()
    into[3] = length.toByte()
  }

  /** Reads until [count] bytes or the end of the stream; returns how many arrived. */
  private fun readUpTo(input: InputStream, into: ByteArray, count: Int): Int {
    var got = 0
    while (got < count) {
      val n = input.read(into, got, count - got)
      if (n < 0) break
      got += n
    }
    return got
  }
}
