package codes.madera.crossfog.link

/**
 * What a staged or queued file holds: an offer's fields as one JSON object with no `v` or `type`,
 * the way builds before the protocol wrote them. The same field checks as [Messages], so a body
 * accepted here is never one the wire parser refuses. A route written before revisions existed has
 * none; one that carries a revision must match its GPX.
 */
object Items {
  fun activityOffer(bytes: ByteArray): ActivityOffer = Messages.activityOffer(Messages.parseObject(bytes))

  fun routeOffer(bytes: ByteArray): RouteOffer = Messages.routeOffer(Messages.parseObject(bytes), requireRevision = false)
}
