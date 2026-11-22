package codes.madera.crossfog.watch.presentation.features.recording

import org.junit.Assert.assertEquals
import org.junit.Test
import org.mapsforge.core.model.LatLong
import java.io.File

/**
 * The phone's parser (mobile/src/history/gpx.ts) reads the GPX this encoder writes. This test encodes a small walk
 * with the shipping encoder and compares it byte for byte with mobile/test/fixtures/watch-encoded-walk.gpx, which
 * the phone's gpx.test.ts parses and handOff.test.ts hands off.
 *
 * Regenerate with UPDATE_WATCH_GPX_FIXTURE=1 ./gradlew :app:testDebugUnitTest --tests '*TraceGpxPhoneFixtureTest*'.
 */
class TraceGpxPhoneFixtureTest {
    @Test
    fun theEncodedWalkMatchesTheFixtureThePhoneParses() {
        val actual =
            encodeRecordedTraceAsGpx(
                title = "Fixture & walk",
                points = walk(),
                summary = walkSummary(),
                exporterVersion = "fixture",
            ).toString(Charsets.UTF_8)

        val fixture = File(FIXTURE_PATH)
        if (System.getenv("UPDATE_WATCH_GPX_FIXTURE") == "1") {
            fixture.parentFile?.mkdirs()
            fixture.writeText(actual, Charsets.UTF_8)
        }
        assertEquals(
            "$FIXTURE_PATH differs from what the encoder writes; regenerate it with UPDATE_WATCH_GPX_FIXTURE=1",
            fixture.readText(Charsets.UTF_8),
            actual,
        )
    }

    // Two segments, so the parser must not measure the jump across the gap; the points differ in which optional
    // fields they carry (the first carries every field the phone reads, the later ones few or none), so a missing field is read as well.
    private fun walk(): List<RecordedTracePoint> =
        listOf(
            point(51.4769, 0.0005, 1_772_359_200_000L, elevation = 45.2, speed = 1.2f, heartRate = 96, steps = 0, cadence = 100),
            point(51.4770, 0.0006, 1_772_359_203_000L, elevation = 45.4, speed = 1.3f, heartRate = 98),
            point(51.4771, 0.0007, 1_772_359_206_500L, accuracy = 9f),
            point(
                51.4775,
                0.0010,
                1_772_359_260_000L,
                startsNewSegment = true,
                segmentStartReason = RecordingSegmentStartReason.GPS_GAP,
            ),
        )

    @Suppress("LongParameterList")
    private fun point(
        latitude: Double,
        longitude: Double,
        timeMillis: Long,
        elevation: Double? = null,
        speed: Float? = null,
        heartRate: Int? = null,
        steps: Int? = null,
        cadence: Int? = null,
        accuracy: Float? = 6f,
        startsNewSegment: Boolean = false,
        segmentStartReason: String? = null,
    ) = RecordedTracePoint(
        latLong = LatLong(latitude, longitude),
        elevationMeters = elevation,
        timeMillis = timeMillis,
        accuracyMeters = accuracy,
        speedMps = speed,
        heartRateBpm = heartRate,
        stepCount = steps,
        cadenceSpm = cadence,
        startsNewSegment = startsNewSegment,
        segmentStartReason = segmentStartReason,
    )

    private fun walkSummary() =
        RecordedTraceSummary(
            activityProfile = "WALK",
            durationSeconds = 33.0,
            totalDurationSeconds = 120.0,
            distanceMeters = 71.5,
            elevationGainMeters = 50.0,
            elevationLossMeters = 20.0,
            currentElevationMeters = 300.0,
            currentSpeedMps = 6.0f,
            averageSpeedMps = 6.67,
            fastestSpeedMps = 8.4,
            fastestSpeedMethod = FASTEST_SPEED_METHOD_CONTINUOUS_SEGMENT_GEOMETRY_V1,
            gpsAccuracyMeters = 5.0f,
            pointCount = 4,
            gpsActiveDurationSeconds = 590.0,
            recordingGapCount = 0,
            recordingMaxGapSeconds = 0.0,
            caloriesGrossKcal = 220.0,
            caloriesActiveKcal = 210.0,
            caloriesRestingKcal = 10.0,
            calorieModel = "cycling_physics_fallback_v1",
            cyclingMechanicalKj = 202.4,
            cyclingPowerSampleSegments = 0,
            cyclingPhysicsSegments = 9,
            heartRateBpm = 98,
            averageHeartRateBpm = 98,
            maxHeartRateBpm = 104,
            stepCount = 47,
            cadenceSpm = 100,
            averageCadenceSpm = 80,
            maxCadenceSpm = 96,
            powerWatts = null,
            averagePowerWatts = null,
            maxPowerWatts = null,
            barometricPressureHpa = null,
            recordingTrackSmoothingMode = "ADAPTIVE",
            recordingDistanceSource = "track",
            recordingTrackFilterVersion = 1,
            recordingElevationFilterVersion = 2,
            smartElevationPressurePointCount = 8,
            smartElevationDemAnchorPointCount = 10,
            smartElevationGpsFallbackPointCount = 2,
        )

    private companion object {
        // Relative to watch/app, where Gradle runs the unit tests.
        const val FIXTURE_PATH = "../../mobile/test/fixtures/watch-encoded-walk.gpx"
    }
}
