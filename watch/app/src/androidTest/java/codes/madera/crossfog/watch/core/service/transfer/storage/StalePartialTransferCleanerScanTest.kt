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
        val before = StalePartialTransferCleaner.scan(context)
        val gpx = context.getDir("gpx", Context.MODE_PRIVATE)
        val downloads = context.getDir("oam_downloads", Context.MODE_PRIVATE)
        val fragment = File(gpx, ".scan-test.gpx.part").apply { writeBytes(ByteArray(10)) }
        val archive = File(downloads, "scan-test.map.zip").apply { writeBytes(ByteArray(25)) }
        val finished = File(gpx, "scan-test.gpx").apply { writeBytes(ByteArray(7)) }
        val strayArchive = File(gpx, "scan-test.map.zip").apply { writeBytes(ByteArray(9)) }
        try {
            val after = StalePartialTransferCleaner.scan(context)

            assertEquals(before.count + 2, after.count)
            assertEquals(before.totalBytes + 35L, after.totalBytes)
        } finally {
            listOf(fragment, archive, finished, strayArchive).forEach { it.delete() }
        }
        assertEquals(before, StalePartialTransferCleaner.scan(context))
    }
}
