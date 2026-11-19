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

    // Points east along latitude 48: the second is about 186 m along, the third about 22 m past it, the last about 745 m in all.
    private val route = listOf(LatLong(48.0, 11.0), LatLong(48.0, 11.0025), LatLong(48.0, 11.0028), LatLong(48.0, 11.01))

    // North of the route by about 55 m, a quarter of the way along it.
    private val here = LatLong(48.0005, 11.0025)

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
    fun aRouteAndALocationSetTheDistanceLeftAlongTheRouteAndTheBearingToThePointAhead() {
        val state = buildBrouterGuideBackState(base, active = true, route = route, currentLocation = here)

        assertNotNull(state.distanceToRouteMeters)
        assertEquals(559.0, state.distanceToRouteMeters!!, 8.0)
        // The target is the first point at least 20 m past the projection: the third one, not the end of the route.
        assertEquals(158f, state.bearingToRouteDegrees!!, 2f)
        // Nothing else in the state is touched.
        assertEquals(
            base.copy(distanceToRouteMeters = state.distanceToRouteMeters, bearingToRouteDegrees = state.bearingToRouteDegrees),
            state,
        )
    }
}
