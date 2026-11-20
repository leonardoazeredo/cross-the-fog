package codes.madera.crossfog.watch.core.service.diagnostics

import codes.madera.crossfog.watch.data.repository.SettingsRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DebugTelemetryCaptureSettingsTest {
    @Before
    fun setUp() {
        DebugTelemetry.setTransitionMarkersEnabledForTests(false)
        DebugTelemetry.setEnabledFromCaptureSettings(false)
        DebugTelemetry.clear()
    }

    @After
    fun tearDown() {
        DebugTelemetry.setEnabledFromCaptureSettings(false)
        DebugTelemetry.clear()
        DebugTelemetry.setTransitionMarkersEnabledForTests(true)
    }

    @Test
    fun `full settings start capture and retain download events without a location service`() =
        runTest {
            val active = MutableStateFlow(true)
            val mode = MutableStateFlow(SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_FULL)
            backgroundScope.launch { DebugTelemetry.observeCaptureSettings(active, mode) }
            runCurrent()

            assertTrue(DebugTelemetry.isEnabled())
            // Buffering precedes the Android Log stub in host unit tests.
            runCatching { DebugTelemetry.log("OamDownload", "event=bundle_start area=test") }
            assertTrue(DebugTelemetry.snapshot().single().contains("event=bundle_start"))
            assertTrue(DebugTelemetry.captureSessionSnapshot().active)
        }

    @Test
    fun `mode changes and disabled capture keep full telemetry correctly gated`() =
        runTest {
            val active = MutableStateFlow(true)
            val mode = MutableStateFlow(SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_BATTERY)
            backgroundScope.launch { DebugTelemetry.observeCaptureSettings(active, mode) }
            runCurrent()
            assertFalse(DebugTelemetry.isEnabled())

            mode.value = SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_FULL
            runCurrent()
            assertTrue(DebugTelemetry.isEnabled())

            mode.value = SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_BATTERY
            runCurrent()
            assertFalse(DebugTelemetry.isEnabled())

            active.value = false
            mode.value = SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_FULL
            runCurrent()
            assertFalse(DebugTelemetry.isEnabled())
        }
}
