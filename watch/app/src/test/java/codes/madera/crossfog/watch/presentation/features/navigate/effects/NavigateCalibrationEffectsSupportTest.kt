package codes.madera.crossfog.watch.presentation.features.navigate.effects

import codes.madera.crossfog.watch.domain.sensors.CompassProviderType
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigateCalibrationEffectsSupportTest {
    @Test
    fun calibrationPromptsSupportedForSensorManagerOnly() {
        assertTrue(supportsCompassCalibrationPrompts(CompassProviderType.SENSOR_MANAGER))
        assertFalse(supportsCompassCalibrationPrompts(CompassProviderType.GOOGLE_FUSED))
    }
}
