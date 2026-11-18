package codes.madera.crossfog.link

import java.security.MessageDigest

/**
 * A route's revision: the SHA-256 of the GPX text as UTF-8 bytes, as 64 lowercase hex digits. The
 * phone and the watch each compute it from the GPX they hold, so a `routeSaved` for an earlier send
 * of the same route id can be told from the one for the send that is current (#115).
 */
object Revision {
  fun of(gpx: String): String =
    MessageDigest.getInstance("SHA-256").digest(gpx.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

  fun isWellFormed(value: String): Boolean = value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' }
}
