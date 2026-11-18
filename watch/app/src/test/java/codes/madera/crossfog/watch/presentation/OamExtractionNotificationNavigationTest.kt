package codes.madera.crossfog.watch.presentation

import codes.madera.crossfog.watch.presentation.navigation.WatchRoutes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OamExtractionNotificationNavigationTest {
    @Test
    fun `installation notification returns the user to Downloads`() {
        assertEquals(WatchRoutes.DOWNLOAD, oamNotificationDestination(ACTION_OPEN_OAM_EXTRACTION))
    }

    @Test
    fun `ordinary app launch does not change the current route`() {
        assertNull(oamNotificationDestination(null))
    }
}
