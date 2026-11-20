package codes.madera.crossfog.watch.presentation.features.navigate

import codes.madera.crossfog.watch.presentation.features.gpx.TrackPoint
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.GpxGuidanceSession
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.GpxGuidanceTuning
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.TurnByTurnGuidanceState
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.buildCumulativeDistances
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.buildGpxGuidanceSession
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.computeTurnByTurnGuidanceState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mapsforge.core.model.LatLong

class NavigateGuidanceGeometryCacheTest {
    @Test
    fun `unrelated recomposition reuses geometry but each fix still gets per fix processing`() {
        val cache = NavigateGuidanceGeometryCache()
        val session = session(trackId = "route.gpx", startReached = true)
        var primaryComputations = 0
        var perFixProcessing = 0

        fun processFix() {
            val fixLocation = LatLong(45.0, 6.0002)
            cache.primaryState(
                session = session,
                currentLocation = fixLocation,
                tuning = GpxGuidanceTuning(),
                previousDistanceFromStartMeters = null,
            ) {
                primaryComputations += 1
                computeTurnByTurnGuidanceState(session, fixLocation)
            }
            perFixProcessing += 1
        }

        processFix()
        processFix()

        assertEquals(1, primaryComputations)
        assertEquals(2, perFixProcessing)
    }

    @Test
    fun `primary cache recomputes when only the location moves and reuses the first fix after`() {
        val cache = NavigateGuidanceGeometryCache()
        val session = session("route.gpx", startReached = true)
        val first = LatLong(45.0, 6.0002)
        val second = LatLong(45.0, 6.0008)
        var computations = 0

        val firstState = cachedState(cache, PrimaryRequest(session, first)) { computations += 1 }
        val movedState = cachedState(cache, PrimaryRequest(session, second)) { computations += 1 }
        assertEquals(2, computations)
        assertNotSame(firstState, movedState)

        val againState = cachedState(cache, PrimaryRequest(session, second)) { computations += 1 }
        assertEquals(2, computations)
        assertSame(movedState, againState)
    }

    @Test
    fun `primary cache invalidates route crossing continuity input`() {
        val cache = NavigateGuidanceGeometryCache()
        val crossingPoints =
            listOf(
                LatLong(45.0000, 6.0000),
                LatLong(45.0010, 6.0010),
                LatLong(45.0000, 6.0020),
                LatLong(44.9990, 6.0010),
                LatLong(45.0000, 6.0000),
                LatLong(45.0010, 5.9990),
            )
        val crossingSession = session("crossing.gpx", crossingPoints, startReached = true)
        val cumulative = buildCumulativeDistances(crossingPoints)
        val crossingLocation = crossingPoints.first()
        var computations = 0

        cachedState(cache, PrimaryRequest(crossingSession, crossingLocation)) { computations += 1 }
        val crossingState =
            cachedState(
                cache,
                PrimaryRequest(
                    session = crossingSession,
                    location = crossingLocation,
                    previousDistanceFromStartMeters = cumulative[3],
                ),
            ) { computations += 1 }

        assertTrue((crossingState.distanceFromStartMeters ?: 0.0) > cumulative[2])
        assertEquals(2, computations)
    }

    @Test
    fun `primary cache preserves relocking computation`() {
        val cache = NavigateGuidanceGeometryCache()
        val relockSession =
            session(
                trackId = "relock.gpx",
                points =
                    listOf(
                        LatLong(45.0000, 6.0000),
                        LatLong(45.0000, 6.0010),
                        LatLong(45.0100, 6.0100),
                        LatLong(45.0100, 6.0110),
                    ),
                startReached = true,
            )
        var computations = 0
        val relockLocation = LatLong(45.0100, 6.0105)
        val relockedState =
            cachedState(
                cache,
                PrimaryRequest(
                    session = relockSession,
                    location = relockLocation,
                    previousDistanceFromStartMeters = 20.0,
                ),
            ) { computations += 1 }

        assertTrue((relockedState.distanceFromStartMeters ?: 0.0) > relockSession.cumulativeDistancesMeters[1])
        assertEquals(1, computations)
    }

    @Test
    fun `primary cache invalidates route replacement reversal start state and tuning`() {
        val cache = NavigateGuidanceGeometryCache()
        val baseSession = session("route.gpx", startReached = true)
        val replacementSession =
            session(
                "route.gpx",
                points =
                    listOf(
                        LatLong(45.0, 6.0),
                        LatLong(45.0, 6.0015),
                        LatLong(45.001, 6.0015),
                    ),
                startReached = true,
            )
        val reversedSession =
            session(
                "route.gpx",
                baseSession.trackPoints.map { it.latLong },
                startReached = true,
                reversed = true,
            )
        val startedSession = baseSession.copy(startReached = false)
        val location = LatLong(45.0, 6.0002)
        var computations = 0

        cachedState(cache, PrimaryRequest(baseSession, location)) { computations += 1 }
        cachedState(cache, PrimaryRequest(replacementSession, location)) { computations += 1 }
        cachedState(cache, PrimaryRequest(reversedSession, location)) { computations += 1 }
        cachedState(cache, PrimaryRequest(startedSession, location)) { computations += 1 }
        cachedState(
            cache,
            PrimaryRequest(
                session = baseSession,
                location = location,
                tuning = GpxGuidanceTuning(offRouteDistanceMeters = 80.0),
            ),
        ) { computations += 1 }

        assertEquals(5, computations)
    }

    private fun session(
        trackId: String,
        points: List<LatLong> =
            listOf(
                LatLong(45.0, 6.0),
                LatLong(45.0, 6.001),
                LatLong(45.001, 6.001),
            ),
        startReached: Boolean,
        reversed: Boolean = false,
    ): GpxGuidanceSession =
        buildGpxGuidanceSession(
            trackId = trackId,
            trackTitle = trackId,
            trackPoints = points.map { TrackPoint(latLong = it, elevation = null) },
            startReached = startReached,
            reversed = reversed,
        )

    private data class PrimaryRequest(
        val session: GpxGuidanceSession,
        val location: LatLong,
        val tuning: GpxGuidanceTuning = GpxGuidanceTuning(),
        val previousDistanceFromStartMeters: Double? = null,
    )

    private fun cachedState(
        cache: NavigateGuidanceGeometryCache,
        request: PrimaryRequest,
        onCompute: () -> Unit,
    ): TurnByTurnGuidanceState =
        cache.primaryState(
            session = request.session,
            currentLocation = request.location,
            tuning = request.tuning,
            previousDistanceFromStartMeters = request.previousDistanceFromStartMeters,
        ) {
            onCompute()
            computeTurnByTurnGuidanceState(
                session = request.session,
                currentLocation = request.location,
                tuning = request.tuning,
                previousDistanceFromStartMeters = request.previousDistanceFromStartMeters,
            )
        }
}
