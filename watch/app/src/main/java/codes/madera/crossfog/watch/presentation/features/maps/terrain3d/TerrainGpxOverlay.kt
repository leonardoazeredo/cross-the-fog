package codes.madera.crossfog.watch.presentation.features.maps.terrain3d

import codes.madera.crossfog.watch.presentation.features.gpx.GpxTrackDetails

internal data class TerrainGpxOverlay(
    val tracks: List<GpxTrackDetails>,
    val color: Int,
    val colorMode: String,
    val width: Float,
    val opacityPercent: Int,
)
