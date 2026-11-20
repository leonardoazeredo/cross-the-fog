package codes.madera.crossfog.link

import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest

/**
 * A route's revision: the SHA-256 of the GPX text as UTF-8 bytes, as 64 lowercase hex digits. The
 * phone and the watch each compute it from the GPX they hold, so a `routeSaved` for an earlier send
 * of the same route id can be told from the one for the send that is current (#115).
 */
object Revision {
  const val HEX_LENGTH = 64

  private const val CHUNK_CHARS = 16 * 1024

  /**
   * Hashes the text as it is encoded, a slice at a time: a track can be 16 MiB, and its byte array would be
   * a second copy of it. The slices are copied into one array-backed buffer because Android's encoder copies
   * a buffer that has no array, the whole text, into one.
   */
  fun of(gpx: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    // Replacement writes an unpaired surrogate as "?", as String.toByteArray does.
    val encoder = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE)
    val chars = CharArray(CHUNK_CHARS)
    val bytes = ByteBuffer.allocate(CHUNK_CHARS * MAX_BYTES_PER_CHAR)
    var at = 0
    while (at < gpx.length) {
      var end = minOf(at + CHUNK_CHARS, gpx.length)
      // A pair is never cut: its high half waits for the next slice, where its low half is.
      if (end < gpx.length && Character.isHighSurrogate(gpx[end - 1])) end--
      gpx.toCharArray(chars, 0, at, end)
      val input = CharBuffer.wrap(chars, 0, end - at)
      encoder.encode(input, bytes, end == gpx.length)
      bytes.flip()
      digest.update(bytes)
      bytes.clear()
      // A trailing unpaired surrogate may be left unconsumed (the JVM) or held inside the encoder (Android): go on from what was taken.
      at = end - input.remaining()
    }
    // Android's encoder keeps a trailing unpaired surrogate until it is flushed; without it the "?" is never written.
    if (gpx.isNotEmpty()) {
      encoder.flush(bytes)
      bytes.flip()
      digest.update(bytes)
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private const val MAX_BYTES_PER_CHAR = 3

  fun isWellFormed(value: String): Boolean = value.length == HEX_LENGTH && value.all { it in '0'..'9' || it in 'a'..'f' }
}
