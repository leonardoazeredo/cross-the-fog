package codes.madera.crossfog.watch.core.service.transfer.storage

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class StalePartialTransferCleanerScanTest {
    @Test
    fun scanCountsFragmentsAndBundleArchivesAndTheirBytesButNotOtherFiles() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        // The app's own startup clean-up runs in this process; do not race it for old leftovers.
        StalePartialTransferCleaner.cleanStale(context)
        val before = StalePartialTransferCleaner.scan(context)
        val gpx = context.getDir("gpx", Context.MODE_PRIVATE)
        val downloads = context.getDir("oam_downloads", Context.MODE_PRIVATE)
        val themes = File(context.filesDir, "mapsforge-themes/.transfers").apply { mkdirs() }
        val dem = context.getExternalFilesDir("dem3") ?: File(context.getDir("maps", Context.MODE_PRIVATE), "dem3").apply { mkdirs() }
        // One fragment in each root scan() looks in, so a dropped root changes the count.
        val fragments =
            listOf(
                gpx,
                context.getDir("maps", Context.MODE_PRIVATE),
                context.getDir("poi", Context.MODE_PRIVATE),
                downloads,
                themes,
                dem,
            ).mapIndexed { index, root -> File(root, ".scan-test-$index.part").apply { writeBytes(ByteArray(10)) } }
        val archive = File(downloads, "scan-test.map.zip").apply { writeBytes(ByteArray(25)) }
        val finished = File(gpx, "scan-test.gpx").apply { writeBytes(ByteArray(7)) }
        val strayArchive = File(gpx, "scan-test.map.zip").apply { writeBytes(ByteArray(9)) }
        try {
            val after = StalePartialTransferCleaner.scan(context)

            assertEquals(before.count + 7, after.count)
            assertEquals(before.totalBytes + 85L, after.totalBytes)
        } finally {
            (fragments + listOf(archive, finished, strayArchive)).forEach { it.delete() }
        }
        assertEquals(before, StalePartialTransferCleaner.scan(context))
    }
}
