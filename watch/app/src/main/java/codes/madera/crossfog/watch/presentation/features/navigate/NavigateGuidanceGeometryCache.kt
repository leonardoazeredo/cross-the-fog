package codes.madera.crossfog.watch.presentation.features.navigate

import codes.madera.crossfog.watch.presentation.features.navigate.guidance.GpxGuidanceSession
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.GpxGuidanceTuning
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.TurnByTurnGuidanceState
import org.mapsforge.core.model.LatLong

/**
 * Memoizes only route geometry work. Per-fix processing must stay outside this cache.
 */
internal class NavigateGuidanceGeometryCache {
    private var primaryKey: PrimaryKey? = null
    private var primaryValue: TurnByTurnGuidanceState? = null

    fun primaryState(
        session: GpxGuidanceSession?,
        currentLocation: LatLong?,
        tuning: GpxGuidanceTuning,
        previousDistanceFromStartMeters: Double?,
        compute: () -> TurnByTurnGuidanceState,
    ): TurnByTurnGuidanceState {
        val key =
            PrimaryKey(
                session = session,
                latitude = currentLocation?.latitude,
                longitude = currentLocation?.longitude,
                tuning = tuning,
                previousDistanceFromStartMeters = previousDistanceFromStartMeters,
            )
        if (key == primaryKey) {
            return checkNotNull(primaryValue)
        }

        return compute().also { value ->
            primaryKey = key
            primaryValue = value
        }
    }

    private data class PrimaryKey(
        val session: GpxGuidanceSession?,
        val latitude: Double?,
        val longitude: Double?,
        val tuning: GpxGuidanceTuning,
        val previousDistanceFromStartMeters: Double?,
    )
}
