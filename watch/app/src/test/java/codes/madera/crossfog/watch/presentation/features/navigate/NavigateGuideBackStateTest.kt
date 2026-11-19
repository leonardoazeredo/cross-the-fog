package codes.madera.crossfog.watch.presentation.features.navigate

import codes.madera.crossfog.watch.presentation.features.navigate.guidance.GuidanceMode
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.TurnByTurnGuidanceState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.mapsforge.core.model.LatLong

class NavigateGuideBackStateTest {
    private val base =
        TurnByTurnGuidanceState(
            active = true,
            mode = GuidanceMode.FOLLOW_ROUTE,
            trackTitle = "Loop",
            nextInstruction = null,
            distanceToInstructionMeters = null,
            distanceToStartMeters = 12.0,
            bearingToStartDegrees = 34f,
            distanceToRouteMeters = 56.0,
            bearingToRouteDegrees = 78f,
            distanceRemainingMeters = null,
            routeProgressFraction = null,
            offRoute = false,
        )

    // About 745 m east along latitude 48, so the middle is about 372 m from either end.
    private val route = listOf(LatLong(48.0, 11.0), LatLong(48.0, 11.01))

    // North of the middle of the route by about 55 m.
    private val here = LatLong(48.0005, 11.005)

    @Test
    fun anEmptyRouteReturnsTheBaseStateUnchanged() {
        assertSame(base, buildBrouterGuideBackState(base, active = true, route = emptyList(), currentLocation = here))
    }

    @Test
    fun aRouteOfOnePointReturnsTheBaseStateUnchanged() {
        assertSame(base, buildBrouterGuideBackState(base, active = true, route = listOf(LatLong(48.0, 11.0)), currentLocation = here))
    }

    @Test
    fun anInactiveGuideReturnsTheBaseStateUnchanged() {
        assertSame(base, buildBrouterGuideBackState(base, active = false, route = route, currentLocation = here))
    }

    @Test
    fun noLocationReturnsTheBaseStateUnchanged() {
        assertSame(base, buildBrouterGuideBackState(base, active = true, route = route, currentLocation = null))
    }

    @Test
    fun aRouteAndALocationSetTheDistanceLeftAlongTheRouteAndTheBearingToAPointJustAhead() {
        val state = buildBrouterGuideBackState(base, active = true, route = route, currentLocation = here)

        assertNotNull(state.distanceToRouteMeters)
        assertEquals(372.0, state.distanceToRouteMeters!!, 8.0)
        // The target is the end of the route (the lookahead runs past the middle), east and a little south of here.
        assertEquals(98.4f, state.bearingToRouteDegrees!!, 2f)
        // Nothing else in the state is touched.
        assertEquals(
            base.copy(distanceToRouteMeters = state.distanceToRouteMeters, bearingToRouteDegrees = state.bearingToRouteDegrees),
            state,
        )
    }
}
