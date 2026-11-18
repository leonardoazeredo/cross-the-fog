package codes.madera.crossfog.watch.presentation.features.maps

import codes.madera.crossfog.watch.core.maps.DemSource
import codes.madera.crossfog.watch.domain.model.maps.theme.RenderThemeSource
import java.io.File

internal data class TerrainSource(
    val mapFile: File,
    val themeFile: File?,
    val externalTheme: RenderThemeSource.External?,
    val mapsforgeThemeName: String?,
    val bundledThemeId: String,
    val demSource: DemSource,
    val textScale: Float,
    val hillShadingEnabled: Boolean,
)
