package codes.madera.crossfog.link

/**
 * The protocol versions this build speaks. A `hello` is always sent as version 1 whatever else its
 * sender speaks, and lists every version the sender can use; the two ends then use the highest one
 * in both lists. An endpoint that finds none (a v1 endpoint receiving `{"versions":[2]}`) answers
 * with its own `hello` and closes the link: it never reads a later message in a version it lacks.
 */
object Protocol {
  const val VERSION = 1
  val SUPPORTED: List<Int> = listOf(VERSION)

  fun negotiate(theirs: List<Int>): Int? = SUPPORTED.filter { it in theirs }.maxOrNull()

  fun agree(theirs: List<Int>): Int =
    negotiate(theirs) ?: throw ProtocolException(ProtocolError.NO_COMMON_VERSION)
}
