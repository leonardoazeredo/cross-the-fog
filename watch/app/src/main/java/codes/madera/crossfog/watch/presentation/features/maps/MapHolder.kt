package codes.madera.crossfog.watch.presentation.features.maps

import androidx.compose.runtime.Stable
import org.mapsforge.map.android.view.MapView

@Stable
data class MapHolder(
    val mapView: MapView,
    val renderer: MapRenderer,
)
