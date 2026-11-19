package codes.madera.crossfog.link

/**
 * Reads the offers a staged or queued file holds: one JSON object of the offer's fields, with the
 * same field checks as [Messages]. The object's `v` and `type`, if any, are not read, and a route
 * with no `revision` is accepted (a carried one must match its GPX), which the wire parser refuses.
 */
object Items {
  fun activityOffer(bytes: ByteArray): ActivityOffer = Messages.activityOffer(Messages.parseObject(bytes)).also(::mustFrame)

  fun routeOffer(bytes: ByteArray): RouteOffer =
    Messages.routeOffer(Messages.parseObject(bytes), requireRevision = false).also(::mustFrame)

  // The wire form adds an envelope (and a revision for a route), so an item that fits the cap bare may not fit
  // once sent; it is refused where it is queued, not left for a send that can never frame it.
  private fun mustFrame(offer: Message) {
    if (Messages.encodedSize(offer) > Framing.MAX_FRAME_BYTES) throw ProtocolException(ProtocolError.FRAME_TOO_LARGE)
  }
}
