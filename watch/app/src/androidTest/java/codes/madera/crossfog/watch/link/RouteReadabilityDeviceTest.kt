package codes.madera.crossfog.watch.link

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the watch calls a route it can read is what its own GPX parser finds points in, checked with that parser on a device. */
class RouteReadabilityDeviceTest {
    private val dir = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir

    private fun readable(gpx: String) = gpxIsReadable(gpx.toByteArray(Charsets.UTF_8), dir)

    @Test
    fun aTrackWithPointsIsReadable() {
        assertTrue(readable("""<gpx version="1.1"><trk><trkseg><trkpt lat="1.0" lon="2.0"/><trkpt lat="1.1" lon="2.1"/></trkseg></trk></gpx>"""))
    }

    @Test
    fun aRouteWithPointsIsReadable() {
        assertTrue(readable("""<gpx version="1.1"><rte><rtept lat="1.0" lon="2.0"/><rtept lat="1.1" lon="2.1"/></rte></gpx>"""))
    }

    @Test
    fun textThatIsNoGpxAndXmlThatHoldsNoPointsAreNotReadable() {
        assertFalse(readable("not xml at all"))
        assertFalse(readable("<gpx>one</gpx>"))
        assertFalse(readable("""<gpx><trk><trkseg></trkseg></trk></gpx>"""))
    }

    @Test
    fun aRouteCutOffMidTagIsNotReadable() {
        assertFalse(readable("""<gpx version="1.1"><trk><trkseg><trkpt lat="1.0" lon="2.0"/><trkpt lat="1."""))
    }

    @Test
    fun theCheckLeavesNoFileBehindInTheDirectory() {
        val before = dir.list()!!.toSet()
        readable("""<gpx><trk><trkseg><trkpt lat="1.0" lon="2.0"/></trkseg></trk></gpx>""")
        readable("nope")
        assertEquals(before, dir.list()!!.toSet())
    }
}
