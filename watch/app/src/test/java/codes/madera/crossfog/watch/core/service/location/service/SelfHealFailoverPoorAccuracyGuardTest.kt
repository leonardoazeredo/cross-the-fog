package codes.madera.crossfog.watch.core.service.location.service

import android.location.Location
import codes.madera.crossfog.watch.core.service.diagnostics.DebugTelemetry
import codes.madera.crossfog.watch.core.service.location.engine.LocationEngine
import codes.madera.crossfog.watch.core.service.location.policy.LocationSourceMode
import codes.madera.crossfog.watch.core.service.location.telemetry.LocationServiceTelemetry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SelfHealFailoverPoorAccuracyGuardTest {
    private var phone: Boolean? = null
    private var now = 100_000L
    private var refreshes = 0

    private fun coordinator(): SelfHealFailoverCoordinator {
        val telemetry = LocationServiceTelemetry(tag = "LocTelemetryTest", summaryIntervalMs = 60_000L)
        DebugTelemetry.setEnabledFromCaptureSettings(false)
        return SelfHealFailoverCoordinator(
            serviceScope = CoroutineScope(SupervisorJob()),
            isServiceActive = { true },
            engine = LocationEngine(telemetry),
            telemetry = telemetry,
            requestLocationUpdateIfNeeded = { refreshes += 1 },
            requestImmediateLocation = {},
            trackingEnabled = { true },
            ambientModeActive = { false },
            hasFinePermission = { true },
            hasCoarsePermission = { true },
            watchGpsOnly = { false },
            passiveLocationExperiment = { false },
            phoneConnected = { phone },
            // A recent fix, so the gap to it is small and the plain accuracy rule decides.
            lastAnyAcceptedFixAtElapsedMs = { now - 500L },
            lastCallbackAcceptedFixAtElapsedMs = { now - 500L },
            lastRequestAppliedAtElapsedMs = { now - 500L },
            expectedIntervalMs = { 10_000L },
            strictFreshMaxAgeMs = { 20_000L },
        )
    }

    // The framework class cannot carry values in a unit test, so the two the rule reads are overridden.
    private fun poorFix(accuracyM: Float): Location =
        object : Location("fused") {
            override fun getAccuracy(): Float = accuracyM

            override fun getElapsedRealtimeNanos(): Long = now * 1_000_000L
        }

    private fun SelfHealFailoverCoordinator.poorFixes(count: Int) {
        repeat(count) {
            now += 1_000L
            maybeTriggerAutoFusedFailover(poorFix(500f), LocationSourceMode.AUTO_FUSED, now)
        }
    }

    @Test
    fun aConnectedPhoneNeverTriggersAFailoverNoMatterHowPoorTheFixes() {
        phone = true
        val c = coordinator()
        c.poorFixes(8)
        assertFalse(c.isAutoFusedFallbackToWatchGps())
        assertEquals(0, refreshes)
    }

    @Test
    fun aDisconnectedPhoneFailsOverAfterTheRequiredStreakOfPoorFixes() {
        phone = false
        val c = coordinator()
        c.poorFixes(3)
        assertFalse(c.isAutoFusedFallbackToWatchGps())
        c.poorFixes(1)
        assertTrue(c.isAutoFusedFallbackToWatchGps())
        assertEquals(1, refreshes)
    }

    @Test
    fun anUnknownPhoneFailsOverAfterTheRequiredStreakAndFurtherPoorFixesDoNotRefreshAgain() {
        phone = null
        val c = coordinator()
        c.poorFixes(4)
        assertTrue(c.isAutoFusedFallbackToWatchGps())
        assertEquals(LocationSourceMode.WATCH_GPS, c.currentLocationSourceMode())
        c.poorFixes(5)
        assertTrue(c.isAutoFusedFallbackToWatchGps())
        assertEquals(1, refreshes)
    }

    @Test
    fun aConnectedPhoneResetsAStreakBuiltWhileItWasUnknown() {
        phone = null
        val c = coordinator()
        c.poorFixes(3)
        phone = true
        c.poorFixes(1)
        phone = null
        c.poorFixes(3)
        assertFalse(c.isAutoFusedFallbackToWatchGps())
        c.poorFixes(1)
        assertTrue(c.isAutoFusedFallbackToWatchGps())
    }
}
