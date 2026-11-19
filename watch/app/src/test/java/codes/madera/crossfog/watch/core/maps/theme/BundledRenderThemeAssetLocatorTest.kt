package codes.madera.crossfog.watch.core.maps.theme

import codes.madera.crossfog.watch.domain.model.maps.theme.mapsforge.MapsforgeThemeCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class BundledRenderThemeAssetLocatorTest {
    @Test
    fun resolvesKnownBundledThemeIdsWithoutFallback() {
        assertEquals(
            MapsforgeThemeCatalog.OPENHIKING_THEME_ID,
            BundledRenderThemeAssetLocator.resolveKnownThemeIdOrNull(MapsforgeThemeCatalog.OPENHIKING_THEME_ID),
        )
        assertEquals(
            MapsforgeThemeCatalog.HIKING_3D_THEME_ID,
            BundledRenderThemeAssetLocator.resolveKnownThemeIdOrNull(MapsforgeThemeCatalog.HIKING_3D_THEME_ID),
        )
    }

    @Test
    fun blankThemeIdDefaultsToOpenHikingButUnknownIdsDoNot() {
        assertEquals(
            MapsforgeThemeCatalog.OPENHIKING_THEME_ID,
            BundledRenderThemeAssetLocator.resolveKnownThemeIdOrNull(""),
        )
        assertNull(BundledRenderThemeAssetLocator.resolveKnownThemeIdOrNull("mapsforge"))
        assertNull(BundledRenderThemeAssetLocator.resolveKnownThemeIdOrNull("frenchkiss-legacy"))
    }

    @Test
    fun everyBundledThemeSpecPointsAtAPackagedXmlFile() {
        listOf(MapsforgeThemeCatalog.OPENHIKING_THEME_ID, MapsforgeThemeCatalog.HIKING_3D_THEME_ID).forEach { id ->
            val path = BundledRenderThemeAssetLocator.generatedXmlPathOrNull(id)
            assertTrue("$id has no spec", path != null)
            assertTrue("$id: src/main/assets/$path is missing", File("src/main/assets/$path").isFile)
        }
        assertNull(BundledRenderThemeAssetLocator.generatedXmlPathOrNull("elevate"))
    }

    @Test
    fun removedThemeIdsAreNoLongerKnown() {
        listOf(
            "elevate",
            "elevate_winter",
            "elevate_winter_white",
            "frenchkiss",
            "tiramisu",
            "hike_ride_sight",
            "voluntary",
            "os_map",
            "os_map_day",
            "os_map_night",
        ).forEach { id ->
            assertNull("$id is still known", BundledRenderThemeAssetLocator.resolveKnownThemeIdOrNull(id))
        }
    }
}
