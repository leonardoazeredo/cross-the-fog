package codes.madera.crossfog.watch.presentation.features.navigate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigatePanTelemetryTest {
    @Test
    fun panSummarySeparatesInputCadenceFromViewportCadence() {
        var nowElapsedMs = 0L
        val messages = mutableListOf<String>()
        val telemetry =
            NavigatePanTelemetry(
                nowElapsedMs = { nowElapsedMs },
                debugEnabled = { true },
                log = { message -> messages += message },
            )

        telemetry.onPanStarted(
            navMode = NavMode.COMPASS_FOLLOW,
            zoomLevel = 15,
        )
        nowElapsedMs = 10L
        telemetry.onInputMove()
        nowElapsedMs = 25L
        telemetry.onViewportChanged()
        nowElapsedMs = 85L
        telemetry.onInputMove()
        nowElapsedMs = 100L
        telemetry.onViewportChanged()
        nowElapsedMs = 120L

        val summary =
            telemetry.onPanFinished(
                navMode = NavMode.PANNING,
                reason = "touch_up",
                zoomLevel = 15,
            )

        assertEquals(120L, summary?.durationMs ?: -1L)
        assertEquals(2, summary?.inputMoveCount ?: -1)
        assertEquals(75L, summary?.maxInputGapMs ?: -1L)
        assertEquals(2, summary?.viewportUpdateCount ?: -1)
        assertEquals(25L, summary?.firstViewportLatencyMs ?: -1L)
        assertEquals(75L, summary?.maxViewportGapMs ?: -1L)
        assertEquals(1, summary?.slowViewportGapCount ?: -1)
        assertTrue(messages.last().contains("event=map_pan stage=end"))
    }
}
