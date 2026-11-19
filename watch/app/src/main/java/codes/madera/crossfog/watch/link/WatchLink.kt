@file:Suppress("TooGenericExceptionCaught", "SwallowedException")

package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.ItemLedger
import codes.madera.crossfog.link.PinStore

/** What the settings row says. */
internal data class WatchLinkStatus(
    val paired: Boolean,
    val asideWalks: Int,
)

/**
 * Takes a saved recording into the outbox. The recording is already on the watch when this runs, so
 * whatever goes wrong here (a full disk, a bug) is logged by class and goes no further: saving a walk
 * must never fail or wait on the link. [add] is where the outbox is first built, so a failure there is
 * contained as well.
 */
internal class RecordingOutboxHook(
    private val add: (gpx: ByteArray, encoderVersion: String) -> Unit,
    encoderVersion: String,
    private val log: (String) -> Unit,
) {
    // The offer takes at most 64 characters, and a build with no name is still a walk worth sending.
    private val version = encoderVersion.trim().ifEmpty { "unknown" }.take(MAX_VERSION)

    fun onSaved(gpx: ByteArray) {
        // Throwable: a walk is big to copy, and an out-of-memory here must not undo a recording already saved.
        try {
            add(gpx, version)
        } catch (e: Throwable) {
            log(e.javaClass.simpleName)
        }
    }

    private companion object {
        const val MAX_VERSION = 64
    }
}

/**
 * The watch's half of the link that does not need a radio: the walks waiting for the phone, the routes
 * it may send, the ledger, and the pairing state. Nothing here can pair or reach a phone; [status]
 * says so by reading what is stored.
 */
internal class WatchLink(
    val outbox: WatchOutbox,
    ledger: ItemLedger,
    val routes: WatchRoutes,
    private val pins: PinStore,
    private val identityPresent: () -> Boolean,
) {
    val events = WatchLinkEvents(ledger, outbox)

    /** Paired is a pin together with the Keystore key it was made for; a pin whose key is gone is cleared. */
    fun status(): WatchLinkStatus = WatchLinkStatus(paired = paired(), asideWalks = asideWalks())

    private fun asideWalks(): Int =
        try {
            outbox.asideCount()
        } catch (e: Exception) {
            0
        }

    private fun paired(): Boolean {
        if (readPin() == null) return false
        // Not knowing is not unpairing: the pin stays and the next read asks again.
        val present =
            try {
                identityPresent()
            } catch (e: Exception) {
                return false
            }
        if (!present) clearPin()
        return present
    }

    private fun readPin(): ByteArray? =
        try {
            pins.get()
        } catch (e: Exception) {
            null
        }

    private fun clearPin() {
        try {
            pins.clear()
        } catch (e: Exception) {
            // The next read asks again.
        }
    }
}
