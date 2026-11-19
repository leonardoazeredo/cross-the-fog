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

  private const val CHUNK_BYTES = 64 * 1024

  /** Hashes the text as it is encoded, a chunk at a time: a track can be 16 MiB, and its byte array would be a second copy of it. */
  fun of(gpx: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    // Replacement writes an unpaired surrogate as "?", as String.toByteArray does.
    val encoder = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE)
    val input = CharBuffer.wrap(gpx)
    val chunk = ByteBuffer.allocate(CHUNK_BYTES)
    do {
      val result = encoder.encode(input, chunk, true)
      chunk.flip()
      digest.update(chunk)
      chunk.clear()
    } while (result.isOverflow)
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  fun isWellFormed(value: String): Boolean = value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' }
}
