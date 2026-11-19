@file:Suppress("TooGenericExceptionCaught", "SwallowedException")

package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.ActivityOffer
import codes.madera.crossfog.link.ActivityOutbox
import codes.madera.crossfog.link.ItemLedger
import codes.madera.crossfog.link.Messages
import java.io.File
import java.util.UUID

/**
 * The walks this watch recorded and the phone has not confirmed, one file per walk named by its id, in
 * the wire form of the offer so what is sent is exactly what was saved. It is separate from the GPX
 * list: a walk leaves here only when the phone confirms it, and never otherwise. One that keeps
 * failing is moved to `aside/` (still readable, never deleted) by [WatchLinkEvents].
 */
internal class WatchOutbox(
    private val dir: File,
    private val ledger: ItemLedger,
    private val syncDir: (File) -> Unit,
) : ActivityOutbox {
    private val asideDir get() = File(dir, WatchLinkNames.ASIDE_DIR)

    /**
     * Queues a recording under a new id and returns it. A new id per save is what keeps a recording that
     * is saved twice from becoming one walk on the phone and a second one on top of it.
     */
    @Synchronized
    fun add(
        gpx: ByteArray,
        encoderVersion: String,
        routeId: String? = null,
        newId: () -> String = { UUID.randomUUID().toString() },
    ): String {
        val id = newId()
        val offer = ActivityOffer(id, routeId, encoderVersion, String(gpx, Charsets.UTF_8))
        writeFileAtomically(dir, "$id$SUFFIX", Messages.encode(offer), syncDir)
        return id
    }

    @Synchronized
    override fun next(): ActivityOffer? {
        val queued = queuedIds()
        val preferred = ledger.prefer(queued) ?: return null
        // The preferred one first, then the rest in age order, so one unreadable file blocks none behind it.
        for (id in listOf(preferred) + queued.filter { it != preferred }) {
            readOffer(File(dir, "$id$SUFFIX"), id)?.let { return it }
        }
        return null
    }

    @Synchronized
    override fun delete(activityId: String) {
        File(dir, "$activityId$SUFFIX").delete()
        ledger.confirmed(activityId)
    }

    /** Moves a walk out of the queue without deleting it, and forgets its counts. */
    @Synchronized
    fun setAside(activityId: String) {
        val file = File(dir, "$activityId$SUFFIX")
        if (file.isFile) {
            asideDir.mkdirs()
            if (!file.renameTo(File(asideDir, "$activityId$SUFFIX"))) throw java.io.IOException("cannot set the walk aside")
            syncDir(asideDir)
            syncDir(dir)
        }
        ledger.forget(activityId)
    }

    @Synchronized
    fun queuedCount(): Int = queuedIds().size

    @Synchronized
    fun asideCount(): Int = idsIn(asideDir).size

    private fun queuedIds(): List<String> = idsIn(dir).sortedWith(compareBy({ File(dir, "$it$SUFFIX").lastModified() }, { it }))

    private fun idsIn(folder: File): List<String> =
        folder
            .listFiles { f -> f.isFile && f.name.endsWith(SUFFIX) }
            ?.map { it.name.removeSuffix(SUFFIX) }
            ?.filter { ID_PATTERN.matches(it) }
            ?: emptyList()

    private fun readOffer(
        file: File,
        id: String,
    ): ActivityOffer? =
        try {
            (Messages.parse(file.readBytes()) as? ActivityOffer)?.takeIf { it.activityId == id }
        } catch (e: Exception) {
            null
        }

    private companion object {
        const val SUFFIX = ".json"
        val ID_PATTERN = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    }
}
