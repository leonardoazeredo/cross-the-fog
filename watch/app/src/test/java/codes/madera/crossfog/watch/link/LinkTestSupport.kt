package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.CloseInfo
import codes.madera.crossfog.link.CloseReason
import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemRef
import codes.madera.crossfog.link.LedgerStore

internal class MemoryLedger : LedgerStore {
    var text: String? = null

    override fun read(): String? = text

    override fun write(text: String) {
        this.text = text
    }
}

internal class MemoryIndex : RouteIndex {
    val entries = mutableMapOf<String, RouteEntry>()

    override fun get(routeId: String): RouteEntry? = entries[routeId]

    override fun put(
        routeId: String,
        entry: RouteEntry,
    ) {
        entries[routeId] = entry
    }
}

internal const val ID_A = "11111111-1111-4111-8111-111111111111"
internal const val ID_B = "22222222-2222-4222-8222-222222222222"
internal const val ID_C = "33333333-3333-4333-8333-333333333333"

/** An activity item of this end's own queue that failed at a store, as a session reports it. */
internal fun storeFailed(id: String) = CloseInfo(CloseReason.STORE_FAILED, ItemRef(ItemKind.ACTIVITY, id), ItemRef(ItemKind.ACTIVITY, id))

/** A session that ended with this activity offered and never confirmed (a timeout, a cut stream). */
internal fun unconfirmed(id: String) = CloseInfo(CloseReason.TIMEOUT, null, ItemRef(ItemKind.ACTIVITY, id))
