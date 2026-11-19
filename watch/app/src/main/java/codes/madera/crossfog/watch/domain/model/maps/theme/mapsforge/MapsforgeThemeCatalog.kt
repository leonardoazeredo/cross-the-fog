package codes.madera.crossfog.watch.domain.model.maps.theme.mapsforge

import org.mapsforge.map.rendertheme.internal.MapsforgeThemes

data class MapsforgeThemeOption(
    val id: String,
    val themeName: String,
    val label: String,
)

object MapsforgeThemeCatalog {
    const val MAPSFORGE_THEME_ID = "mapsforge"
    const val OPENHIKING_THEME_ID = "openhiking"

    /** Minimal bundled theme tuned for draped 3D terrain; also selectable for the 2D map. */
    const val HIKING_3D_THEME_ID = "hiking_3d"
    private const val MAPSFORGE_THEME_PREFIX = "mapsforge:"

    /**
     * Bundled themes dropped for their licence (non-commercial or none on record). None is bundled, so
     * [bundledThemeOrDefault] never returns one and a stored choice of one resolves to [defaultThemeId].
     */
    private val REMOVED_BUNDLED_THEME_IDS =
        setOf(
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

    val LEGACY_HILLSHADING_THEME_ID = "$MAPSFORGE_THEME_PREFIX${MapsforgeThemes.HILLSHADING.name}"
    val DEFAULT_MAPSFORGE_STYLE_ID = "$MAPSFORGE_THEME_PREFIX${MapsforgeThemes.DEFAULT.name}"
    val DEFAULT_MAPSFORGE_THEME_ID = DEFAULT_MAPSFORGE_STYLE_ID
    val DARK_MAPSFORGE_STYLE_ID = "$MAPSFORGE_THEME_PREFIX${MapsforgeThemes.DARK.name}"

    val options: List<MapsforgeThemeOption> =
        listOf(
            MapsforgeThemeOption(
                id = DEFAULT_MAPSFORGE_STYLE_ID,
                themeName = MapsforgeThemes.DEFAULT.name,
                label = "Classic",
            ),
            MapsforgeThemeOption(
                id = "$MAPSFORGE_THEME_PREFIX${MapsforgeThemes.OSMARENDER.name}",
                themeName = MapsforgeThemes.OSMARENDER.name,
                label = "OSMARender",
            ),
            MapsforgeThemeOption(
                id = "$MAPSFORGE_THEME_PREFIX${MapsforgeThemes.MOTORIDER.name}",
                themeName = MapsforgeThemes.MOTORIDER.name,
                label = "Motorider",
            ),
            MapsforgeThemeOption(
                id = "$MAPSFORGE_THEME_PREFIX${MapsforgeThemes.BIKER.name}",
                themeName = MapsforgeThemes.BIKER.name,
                label = "Biker",
            ),
            MapsforgeThemeOption(
                id = DARK_MAPSFORGE_STYLE_ID,
                themeName = MapsforgeThemes.DARK.name,
                label = "Dark",
            ),
            MapsforgeThemeOption(
                id = "$MAPSFORGE_THEME_PREFIX${MapsforgeThemes.INDIGO.name}",
                themeName = MapsforgeThemes.INDIGO.name,
                label = "Indigo",
            ),
        )

    private val byId: Map<String, MapsforgeThemeOption> = options.associateBy { it.id }
    private val validThemeNames = MapsforgeThemes.values().map { it.name }.toSet()

    fun optionById(themeId: String?): MapsforgeThemeOption? = themeId?.let(byId::get)

    fun defaultOption(): MapsforgeThemeOption = byId.getValue(DEFAULT_MAPSFORGE_STYLE_ID)

    fun isValidThemeName(name: String): Boolean = name in validThemeNames

    fun isMapsforgeFamilyTheme(themeId: String?): Boolean = themeId == MAPSFORGE_THEME_ID

    fun isMapsforgeStyleId(themeId: String?): Boolean = optionById(themeId) != null

    fun isBundledAssetTheme(themeId: String?): Boolean = themeId == OPENHIKING_THEME_ID || themeId == HIKING_3D_THEME_ID

    fun isRemovedBundledTheme(themeId: String?): Boolean = themeId in REMOVED_BUNDLED_THEME_IDS

    /** OpenHiking, or the built-in Classic style when OpenHiking's asset is missing. */
    fun defaultThemeId(isAvailable: (String) -> Boolean): String =
        if (isAvailable(OPENHIKING_THEME_ID)) OPENHIKING_THEME_ID else DEFAULT_MAPSFORGE_STYLE_ID

    /**
     * A stored bundled-theme choice if it still names a bundled theme whose asset is there, else the
     * default; blank, unknown and removed ids all end up on the default.
     */
    fun bundledThemeOrDefault(
        stored: String?,
        isAvailable: (String) -> Boolean,
    ): String {
        val id = stored?.trim()
        return if (isBundledAssetTheme(id) && isAvailable(id!!)) id else defaultThemeId(isAvailable)
    }
}
