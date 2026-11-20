package codes.madera.crossfog.watch.core.service.location.service

import codes.madera.crossfog.watch.core.service.diagnostics.DebugTelemetry
import codes.madera.crossfog.watch.core.service.location.engine.LocationEngine
import codes.madera.crossfog.watch.core.service.location.engine.RequestSpec
import codes.madera.crossfog.watch.core.service.location.policy.LocationRuntimeMode
import codes.madera.crossfog.watch.core.service.location.policy.LocationSourceMode
import codes.madera.crossfog.watch.core.service.location.telemetry.LocationServiceTelemetry
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The scheduled phone check turns a watch-GPS failover back into the phone only on a definite "connected" answer:
 * the app has no phone signal, so its check answers unknown, and unknown must leave the failover in place.
 */
class SelfHealPhoneRecheckTest {
    private class Rig(
        answer: Boolean?,
    ) {
        var asked = 0
        var refreshes = 0
        val coordinator: SelfHealFailoverCoordinator

        init {
            val telemetry = LocationServiceTelemetry(tag = "LocTelemetryTest", summaryIntervalMs = 60_000L)
            DebugTelemetry.setEnabledFromCaptureSettings(false)
            val engine = LocationEngine(telemetry)
            engine.markRequestApplied(
                RequestSpec(
                    priority = Priority.PRIORITY_HIGH_ACCURACY,
                    intervalMs = 3_000L,
                    minDistanceMeters = 1f,
                    mode = LocationRuntimeMode.INTERACTIVE,
                    sourceMode = LocationSourceMode.WATCH_GPS,
                ),
            )
            coordinator =
                SelfHealFailoverCoordinator(
                    serviceScope = CoroutineScope(SupervisorJob()),
                    isServiceActive = { true },
                    engine = engine,
                    telemetry = telemetry,
                    requestLocationUpdateIfNeeded = { refreshes += 1 },
                    requestImmediateLocation = {},
                    trackingEnabled = { true },
                    ambientModeActive = { false },
                    hasFinePermission = { true },
                    hasCoarsePermission = { true },
                    watchGpsOnly = { false },
                    passiveLocationExperiment = { false },
                    phoneConnected = { null },
                    checkPhoneConnection = {
                        asked += 1
                        answer
                    },
                    lastAnyAcceptedFixAtElapsedMs = { 39_000L },
                    lastCallbackAcceptedFixAtElapsedMs = { 39_000L },
                    lastRequestAppliedAtElapsedMs = { 39_000L },
                    expectedIntervalMs = { 3_000L },
                    strictFreshMaxAgeMs = { 6_000L },
                )
            assertTrue(coordinator.forceAutoFusedFallbackToWatchGps("phone_disconnected", nowElapsedMs = 1_000L))
        }
    }

    @Test
    fun anUnknownAnswerLeavesTheFailoverInPlace() {
        val rig = Rig(answer = null)

        runBlocking { rig.coordinator.maybeRecheckPhoneConnection(nowElapsedMs = 100_000L) }

        assertEquals(1, rig.asked)
        assertTrue(rig.coordinator.isAutoFusedFallbackToWatchGps())
        assertEquals(LocationSourceMode.WATCH_GPS, rig.coordinator.currentLocationSourceMode())
        assertEquals(0, rig.refreshes)
    }

    @Test
    fun aConnectedAnswerClearsTheFailoverAndRefreshesTheRequest() {
        val rig = Rig(answer = true)

        runBlocking { rig.coordinator.maybeRecheckPhoneConnection(nowElapsedMs = 100_000L) }

        assertEquals(1, rig.asked)
        assertFalse(rig.coordinator.isAutoFusedFallbackToWatchGps())
        assertEquals(LocationSourceMode.AUTO_FUSED, rig.coordinator.currentLocationSourceMode())
        assertEquals(1, rig.refreshes)
    }

    @Test
    fun aDisconnectedAnswerLeavesTheFailoverInPlace() {
        val rig = Rig(answer = false)

        runBlocking { rig.coordinator.maybeRecheckPhoneConnection(nowElapsedMs = 100_000L) }

        assertEquals(1, rig.asked)
        assertTrue(rig.coordinator.isAutoFusedFallbackToWatchGps())
        assertEquals(0, rig.refreshes)
    }

    @Test
    fun theCheckIsNotAskedBeforeItIsDue() {
        val rig = Rig(answer = true)

        // The failover was forced at 1 s; the next check is due 30 s later.
        runBlocking { rig.coordinator.maybeRecheckPhoneConnection(nowElapsedMs = 20_000L) }

        assertEquals(0, rig.asked)
        assertTrue(rig.coordinator.isAutoFusedFallbackToWatchGps())
    }
}
