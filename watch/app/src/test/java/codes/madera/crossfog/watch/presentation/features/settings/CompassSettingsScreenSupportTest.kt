package codes.madera.crossfog.watch.presentation.features.settings

import codes.madera.crossfog.watch.domain.sensors.CompassProviderType
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompassSettingsScreenSupportTest {
    @Test
    fun googleFusedUsesAutomaticNorthReferenceInformation() {
        assertTrue(usesAutomaticGoogleNorthReference(CompassProviderType.GOOGLE_FUSED))
    }

    @Test
    fun customSensorsKeepSelectableNorthReference() {
        assertFalse(usesAutomaticGoogleNorthReference(CompassProviderType.SENSOR_MANAGER))
    }
}
