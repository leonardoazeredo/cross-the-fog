package codes.madera.crossfog.watch.presentation.features.settings

import codes.madera.crossfog.watch.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class SettingsResourceIdsTest {
    @Test
    fun debuggingLabelsUseLinkedResourceIds() {
        val screen =
            Class.forName("codes.madera.crossfog.watch.presentation.features.settings.DebuggingSettingsScreenKt")
        listOf(
            "CLEAN_CAPTURE_DEFAULT_LABEL" to R.string.debug_clear_all_captured_logs,
            "CLEAN_CAPTURE_CLEARED_LABEL" to R.string.debug_all_captured_logs_have_been_cleared,
        ).forEach { (name, expected) ->
            assertNotEquals("Linked resource ID must be valid", 0, expected)
            // Read the actual compiled aliases used during the screen's initial composition.
            val field = screen.getDeclaredField(name).apply { isAccessible = true }
            assertEquals(name, expected, field.getInt(null))
        }
    }

    @Test
    fun gpxFilterLabelsUseLinkedResourceIds() {
        listOf(
            R.string.settings_smoothing_distance to GpxElevationFilterUi.SMOOTHING_LABEL,
            R.string.settings_noise_threshold to GpxElevationFilterUi.NOISE_THRESHOLD_LABEL,
            R.string.settings_trend_threshold to GpxElevationFilterUi.TREND_THRESHOLD_LABEL,
        ).forEach { (expected, actual) ->
            assertNotEquals("Linked resource ID must be valid", 0, expected)
            assertEquals(expected, actual)
        }
    }
}
