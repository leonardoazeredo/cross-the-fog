package codes.madera.crossfog.watch.link

import codes.madera.crossfog.watch.presentation.features.gpx.ParsedGpxData
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

/**
 * The temporary file the readability check makes. Whether a GPX has points is its parser's call, which only runs
 * for real on a device (`RouteReadabilityDeviceTest`); here the file's life is what is checked.
 */
class RouteReadabilityTest {
    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun theCheckLeavesNoFileBehind() {
        gpxIsReadable("""<gpx><trk><trkseg><trkpt lat="1.0" lon="2.0"/></trkseg></trk></gpx>""".toByteArray(), tmp.root)
        gpxIsReadable("nope".toByteArray(), tmp.root)
        assertEquals(emptyList<String>(), tmp.root.list()!!.toList())
    }

    @Test
    fun aDirectoryThatCannotBeWrittenIsAnIoErrorNotAVerdict() {
        val missing = File(tmp.root, "no/such/dir")
        assertThrows(IOException::class.java) { gpxIsReadable("<gpx/>".toByteArray(), missing) }
    }

    private fun nothing() = ParsedGpxData(title = null, points = emptyList(), totalDistance = 0.0)

    @Test
    fun aFileThatVanishedBeforeItWasReadIsAnIoErrorNotAVerdict() {
        val e = assertThrows(IOException::class.java) {
            gpxIsReadable("<gpx/>".toByteArray(), tmp.root) { file ->
                file.delete()
                nothing()
            }
        }
        assertTrue(e.message!!.isNotEmpty())
        assertEquals(emptyList<String>(), tmp.root.list()!!.toList())
    }

    @Test
    fun aParserThatFindsNothingInAnIntactFileIsAVerdict() {
        assertFalse(gpxIsReadable("<gpx/>".toByteArray(), tmp.root) { nothing() })
    }
}
