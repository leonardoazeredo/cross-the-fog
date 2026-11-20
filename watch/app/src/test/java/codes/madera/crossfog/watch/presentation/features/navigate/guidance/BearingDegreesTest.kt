package codes.madera.crossfog.watch.presentation.features.navigate.guidance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mapsforge.core.model.LatLong

/**
 * The off-route arrow and the way back to the start turn by this bearing, so its zero and its direction of turn are
 * pinned.
 */
class BearingDegreesTest {
    private val here = LatLong(48.0, 11.0)

    @Test
    fun northIsZeroAndTheBearingTurnsClockwise() {
        assertEquals(0.0, bearingDegrees(here, LatLong(48.01, 11.0)), 0.01)
        // On a great circle the due-east heading at this latitude is a hair under 90.
        assertEquals(90.0, bearingDegrees(here, LatLong(48.0, 11.01)), 0.1)
        assertEquals(180.0, bearingDegrees(here, LatLong(47.99, 11.0)), 0.01)
        assertEquals(270.0, bearingDegrees(here, LatLong(48.0, 10.99)), 0.1)
    }

    @Test
    fun theBearingStaysInZeroToThreeSixty() {
        val northWest = bearingDegrees(here, LatLong(48.01, 10.99))
        assertTrue("north-west came out as $northWest", northWest in 270.0..360.0)
    }
}
