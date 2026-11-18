package codes.madera.crossfog.link

/**
 * The protocol versions this build speaks. A `hello` is always sent as version 1 whatever else its
 * sender speaks, and lists every version the sender can use; the two ends use the highest one in
 * both lists. [agree] throws when there is none. The rule for an endpoint that finds none is to
 * answer with its own `hello` and close the link, never reading a later message in a version it lacks.
 */
object Protocol {
  const val VERSION = 1
  val SUPPORTED: List<Int> = listOf(VERSION)

  fun negotiate(theirs: List<Int>): Int? = SUPPORTED.filter { it in theirs }.maxOrNull()

  fun agree(theirs: List<Int>): Int =
    negotiate(theirs) ?: throw ProtocolException(ProtocolError.NO_COMMON_VERSION)
}
