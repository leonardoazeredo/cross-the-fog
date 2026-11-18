package codes.madera.crossfog.link

object Ids {
  /**
   * The id form an id must have: an RFC 4122 UUID with a real version and variant (the nil and max
   * UUIDs are refused). The phone's staging store turns an id into a file name with the same
   * check, so a message accepted here is never one it refuses.
   */
  val UUID = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")
}
