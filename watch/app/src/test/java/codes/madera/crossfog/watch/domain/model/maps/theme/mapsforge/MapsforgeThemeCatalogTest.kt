package codes.madera.crossfog.watch.domain.model.maps.theme.mapsforge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MapsforgeThemeCatalogTest {
    // The ids as an upgraded install may still store them (global key, per-map key, the 3D shortcut's
    // remembered theme), written out because the catalog no longer has constants for them.
    private val removedIds =
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
        )

    @Test
    fun onlyFreeLicenceBundledThemesAreRecognized() {
        assertTrue(MapsforgeThemeCatalog.isBundledAssetTheme(MapsforgeThemeCatalog.OPENHIKING_THEME_ID))
        assertTrue(MapsforgeThemeCatalog.isBundledAssetTheme(MapsforgeThemeCatalog.HIKING_3D_THEME_ID))
        removedIds.forEach { id ->
            assertFalse("$id is still a bundled theme", MapsforgeThemeCatalog.isBundledAssetTheme(id))
            assertTrue("$id is not listed as removed", MapsforgeThemeCatalog.isRemovedBundledTheme(id))
        }
        assertFalse(MapsforgeThemeCatalog.isRemovedBundledTheme(MapsforgeThemeCatalog.OPENHIKING_THEME_ID))
        assertFalse(MapsforgeThemeCatalog.isRemovedBundledTheme(MapsforgeThemeCatalog.HIKING_3D_THEME_ID))
        assertFalse(MapsforgeThemeCatalog.isRemovedBundledTheme(MapsforgeThemeCatalog.DEFAULT_MAPSFORGE_STYLE_ID))
        assertFalse(MapsforgeThemeCatalog.isRemovedBundledTheme(null))
    }

    @Test
    fun defaultThemeIsOpenHikingAndFallsBackToClassicWhenItsAssetIsMissing() {
        assertEquals("openhiking", MapsforgeThemeCatalog.defaultThemeId { true })
        assertEquals(
            MapsforgeThemeCatalog.DEFAULT_MAPSFORGE_STYLE_ID,
            MapsforgeThemeCatalog.defaultThemeId { false },
        )
    }

    @Test
    fun aStoredRemovedThemeFallsBackToTheDefault() {
        removedIds.forEach { id ->
            assertEquals(
                "$id did not fall back",
                "openhiking",
                MapsforgeThemeCatalog.bundledThemeOrDefault(id) { true },
            )
            assertEquals(
                "$id did not fall back to Classic with no OpenHiking asset",
                MapsforgeThemeCatalog.DEFAULT_MAPSFORGE_STYLE_ID,
                MapsforgeThemeCatalog.bundledThemeOrDefault(id) { false },
            )
        }
    }

    @Test
    fun aStoredKeptThemeStaysWhileItsAssetIsThere() {
        assertEquals(
            "hiking_3d",
            MapsforgeThemeCatalog.bundledThemeOrDefault(MapsforgeThemeCatalog.HIKING_3D_THEME_ID) { true },
        )
        assertEquals(
            "openhiking",
            MapsforgeThemeCatalog.bundledThemeOrDefault(MapsforgeThemeCatalog.OPENHIKING_THEME_ID) { true },
        )
        assertEquals(
            "openhiking",
            MapsforgeThemeCatalog.bundledThemeOrDefault(MapsforgeThemeCatalog.HIKING_3D_THEME_ID) {
                it == "openhiking"
            },
        )
    }

    @Test
    fun blankOrUnknownStoredThemeFallsBackToTheDefault() {
        listOf(null, "", "  ", "something-else").forEach { stored ->
            assertEquals("openhiking", MapsforgeThemeCatalog.bundledThemeOrDefault(stored) { true })
        }
    }

    @Test
    fun defaultMapsforgeStyleStaysClassic() {
        assertTrue(MapsforgeThemeCatalog.isMapsforgeFamilyTheme(MapsforgeThemeCatalog.MAPSFORGE_THEME_ID))
        assertEquals("Classic", MapsforgeThemeCatalog.defaultOption().label)
        assertEquals(
            MapsforgeThemeCatalog.DEFAULT_MAPSFORGE_STYLE_ID,
            MapsforgeThemeCatalog.defaultOption().id,
        )
    }
}
