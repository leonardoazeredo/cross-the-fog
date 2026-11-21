package codes.madera.crossfog.watch.link

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** What the watch calls a route it can read is what its own GPX parser finds points in, checked with that parser on a device. */
class RouteReadabilityDeviceTest {
    // Its own directory, so nothing else writing to the app's cache can change the listing the last test compares.
    private val dir =
        File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "route-readability-test").also { it.mkdirs() }

    private fun readable(gpx: String) = gpxIsReadable(gpx.toByteArray(Charsets.UTF_8), dir)

    @Test
    fun aTrackWithPointsIsReadable() {
        assertTrue(readable("""<gpx version="1.1"><trk><trkseg><trkpt lat="1.0" lon="2.0"/><trkpt lat="1.1" lon="2.1"/></trkseg></trk></gpx>"""))
    }

    // A copy of what the page's toGPX writes (namespace, metadata with the route id, elevations), since that is what the phone sends.
    @Test
    fun theGpxThePageWritesIsReadable() {
        assertTrue(
            readable(
                """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FogToMaps" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/</license></copyright>
    <link href="https://www.openstreetmap.org/copyright"><text>Map data © OpenStreetMap contributors</text></link>
    <keywords>crossfog-route:11111111-1111-4111-8111-111111111111</keywords>
  </metadata>
  <trk>
    <name>FogToMaps route</name>
    <trkseg>
      <trkpt lat="1.000000" lon="2.000000"><ele>10.0</ele></trkpt>
      <trkpt lat="1.001000" lon="2.001000"><ele>11.5</ele></trkpt>
    </trkseg>
  </trk>
</gpx>
""",
            ),
        )
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
