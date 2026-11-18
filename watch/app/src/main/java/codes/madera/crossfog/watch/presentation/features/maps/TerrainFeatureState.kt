package codes.madera.crossfog.watch.presentation.features.maps

import codes.madera.crossfog.watch.core.maps.DemCoverageSummary

internal data class TerrainFeatureState(
    val hill: Boolean,
    val slope: Boolean,
)

internal suspend fun disableTerrainFeatures(
    state: TerrainFeatureState,
    disableHill: suspend () -> Unit,
    disableSlope: suspend () -> Unit,
): Boolean {
    if (state.hill) disableHill()
    if (state.slope) disableSlope()
    return state.hill || state.slope
}

internal suspend fun selectMapWithTerrainGuard(
    path: String?,
    coverage: suspend (String) -> DemCoverageSummary,
    disableFeatures: suspend () -> Boolean,
    select: suspend (String?) -> Unit,
    notifyMissing: (String) -> Unit,
) {
    val summary = path?.let { coverage(it) }
    val noTerrain = summary != null && summary.isCoverageKnown && summary.availableTiles == 0
    val disabled = noTerrain && disableFeatures()
    select(path)
    if (disabled) notifyMissing(path)
}
