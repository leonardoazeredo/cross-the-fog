package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.RouteOffer
import codes.madera.crossfog.link.SaveResult
import codes.madera.crossfog.link.WatchRouteStore
import java.io.IOException

/** The revision of a route this watch holds and the GPX file it was written to. */
internal data class RouteEntry(
    val revision: String,
    val file: String,
)

/** Which revision of each route is on this watch, and in which file. */
internal interface RouteIndex {
    fun get(routeId: String): RouteEntry?

    fun put(
        routeId: String,
        entry: RouteEntry,
    )
}

/**
 * Where the routes the phone sends land: GPX files in the watch's own GPX directory, so they show up in
 * its list like any other, and an index of route id -> revision and file so a resend of the same
 * revision is answered without a write and a new revision replaces the file in place. [write] is the
 * repository's atomic write and returns the hash of what it wrote, which has to be the revision the
 * phone named, so a route is never confirmed on the strength of a file that differs from what was sent.
 */
internal class WatchRoutes(
    private val index: RouteIndex,
    private val write: (fileName: String, bytes: ByteArray) -> String?,
    private val fileExists: (fileName: String) -> Boolean,
) : WatchRouteStore {
    @Synchronized
    override fun save(offer: RouteOffer): SaveResult {
        val held = index.get(offer.routeId)
        if (held != null && held.revision == offer.revision && fileExists(held.file)) return SaveResult.ALREADY_HELD
        // The name comes from the id alone: the route's own name is the peer's text and stays inside the file.
        val fileName = "${WatchLinkNames.ROUTE_FILE_PREFIX}${offer.routeId}.gpx"
        val hash = write(fileName, offer.gpx.toByteArray(Charsets.UTF_8))
        if (hash == null || !hash.equals(offer.revision, ignoreCase = true)) throw IOException("route written does not match its revision")
        index.put(offer.routeId, RouteEntry(offer.revision, fileName))
        return SaveResult.SAVED
    }
}
