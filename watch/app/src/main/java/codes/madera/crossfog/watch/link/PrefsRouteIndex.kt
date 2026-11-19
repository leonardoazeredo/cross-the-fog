package codes.madera.crossfog.watch.link

import android.content.Context
import android.util.Log
import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import codes.madera.crossfog.watch.BuildConfig
import codes.madera.crossfog.watch.data.repository.GpxRepositoryImpl
import kotlinx.coroutines.runBlocking
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException

/** Route id -> revision and file, kept in preferences; a write that cannot be committed is an error, not a silent loss. */
internal class PrefsRouteIndex(
    context: Context,
) : RouteIndex {
    private val prefs = context.getSharedPreferences(WatchLinkNames.ROUTES_PREFS, Context.MODE_PRIVATE)

    override fun get(routeId: String): RouteEntry? {
        val parts = prefs.getString(routeId, null)?.split(' ') ?: return null
        return if (parts.size == 2) RouteEntry(parts[0], parts[1]) else null
    }

    override fun put(
        routeId: String,
        entry: RouteEntry,
    ) {
        if (!prefs.edit().putString(routeId, "${entry.revision} ${entry.file}").commit()) throw IOException("cannot index the route")
    }
}

/** Builds the watch's link from the app's own directories and the GPX repository the routes land in. */
internal fun createWatchLink(
    context: Context,
    gpxRepository: GpxRepositoryImpl,
): WatchLink {
    val linkDir = context.getDir(WatchLinkNames.LINK_DIR, Context.MODE_PRIVATE)
    val ledger = ItemLedger(FileLedgerStore(linkDir, ::fsyncDirectory), ItemKind.ACTIVITY)
    val outbox = WatchOutbox(context.getDir(WatchLinkNames.OUTBOX_DIR, Context.MODE_PRIVATE), ledger, ::fsyncDirectory)
    val routes =
        WatchRoutes(
            index = PrefsRouteIndex(context),
            // The save runs on the link's own thread, which waits for the answer before confirming the route.
            write = { name, bytes ->
                runBlocking { gpxRepository.saveGpxFileAtomic(name, ByteArrayInputStream(bytes), {}, bytes.size.toLong()) }
            },
            fileExists = { name -> File(runBlocking { gpxRepository.absolutePathForFileName(name) }).isFile },
        )
    return WatchLink(
        outbox = outbox,
        ledger = ledger,
        routes = routes,
        pins = FilePinStore(linkDir, ::fsyncDirectory),
        identityPresent = { WatchKeystoreIdentity.exists() },
        encoderVersion = BuildConfig.VERSION_NAME,
        // Only the class of a failure is logged: a message could carry a place name.
        log = { errorClass -> Log.w(TAG, "could not queue the recording: $errorClass") },
    )
}

private const val TAG = "WatchLink"
