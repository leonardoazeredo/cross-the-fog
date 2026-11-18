package codes.madera.crossfog.link

/**
 * What a staged or queued file holds: an offer's fields as one JSON object with no `v` or `type`,
 * the way builds before the protocol wrote them. The same field checks as [Messages], so a body
 * accepted here is never one the wire parser refuses. A route written before revisions existed has
 * none; one that carries a revision must match its GPX.
 */
object Items {
  fun activityOffer(bytes: ByteArray): ActivityOffer = Messages.activityOffer(Messages.parseObject(bytes)).also(::mustFrame)

  fun routeOffer(bytes: ByteArray): RouteOffer =
    Messages.routeOffer(Messages.parseObject(bytes), requireRevision = false).also(::mustFrame)

  // The wire form adds an envelope and a revision, so an item that fits the cap bare may not fit once sent;
  // it is refused where it is queued, not left in the outbox for a send that can never frame it.
  private fun mustFrame(offer: Message) {
    if (Messages.encode(offer).size > Framing.MAX_FRAME_BYTES) throw ProtocolException(ProtocolError.FRAME_TOO_LARGE)
  }
}
