package codes.madera.crossfog.watch.presentation.features.settings

import codes.madera.crossfog.watch.domain.sensors.CompassProviderType
import codes.madera.crossfog.watch.presentation.features.navigate.CompassMarkerQuality
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompassRecalibrationDialogSupportTest {
    @Test
    fun customCompassResetSucceedsWhenQualityImproves() {
        assertTrue(
            didCompleteCompassRecalibration(
                providerType = CompassProviderType.SENSOR_MANAGER,
                headingSourceResolved = true,
                qualityImproved = true,
                resultQuality = CompassMarkerQuality.LOW,
            ),
        )
    }

    @Test
    fun customCompassResetAlsoSucceedsWhenQualityIsUsableWithoutImprovement() {
        assertTrue(
            didCompleteCompassRecalibration(
                providerType = CompassProviderType.SENSOR_MANAGER,
                headingSourceResolved = true,
                qualityImproved = false,
                resultQuality = CompassMarkerQuality.MEDIUM,
            ),
        )
    }

    @Test
    fun customCompassResetFailsWithoutResolvedHeadingSource() {
        assertFalse(
            didCompleteCompassRecalibration(
                providerType = CompassProviderType.SENSOR_MANAGER,
                headingSourceResolved = false,
                qualityImproved = true,
                resultQuality = CompassMarkerQuality.GOOD,
            ),
        )
    }

    @Test
    fun googleFusedNeverUsesCustomResetSuccessPath() {
        assertFalse(
            didCompleteCompassRecalibration(
                providerType = CompassProviderType.GOOGLE_FUSED,
                headingSourceResolved = true,
                qualityImproved = true,
                resultQuality = CompassMarkerQuality.GOOD,
            ),
        )
    }
}
