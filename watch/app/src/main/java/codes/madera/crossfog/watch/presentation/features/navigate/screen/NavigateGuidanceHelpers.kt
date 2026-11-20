package codes.madera.crossfog.watch.presentation.features.navigate

import codes.madera.crossfog.watch.data.repository.SettingsRepository
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.TurnByTurnGuidanceState
import java.util.Locale
import kotlin.math.abs

internal fun shouldUpdateZoomReferenceLatitude(
    currentLatitude: Double,
    nextLatitude: Double,
): Boolean =
    !currentLatitude.isFinite() ||
        abs(currentLatitude - nextLatitude) >= MAP_ZOOM_LATITUDE_UPDATE_THRESHOLD_DEGREES

internal fun buildTurnByTurnTelemetryMessage(
    state: TurnByTurnGuidanceState,
    trackId: String?,
    reversed: Boolean?,
    startReached: Boolean?,
    showGuideBackPrompt: Boolean,
    pendingStartDecision: GuidanceStartDecision?,
    paused: Boolean,
    routeStartBehavior: String,
    reverseSuggestionMode: String,
    offRouteThresholdMeters: Int,
    hapticsEnabled: Boolean,
    voiceGuidanceEnabled: Boolean,
    turnAlertsMode: String,
    offRouteAlertsEnabled: Boolean,
    guidanceGpsInAmbient: Boolean,
    activityProfile: String = SettingsRepository.DEFAULT_ACTIVITY_PROFILE,
    resolvedGpsIntervalMs: Long = SettingsRepository.DEFAULT_GPS_INTERVAL_MS,
    resolvedEtaFlatSpeedMps: Float = SettingsRepository.DEFAULT_GPX_FLAT_SPEED_MPS,
    resolvedTurnAlertMaxDistanceMeters: Double =
        turnAlertMaxDistanceMeters(SettingsRepository.DEFAULT_ACTIVITY_PROFILE),
): String {
    val instruction = state.nextInstruction
    return buildString {
        append("active=${state.active}")
        append(" paused=$paused")
        append(" mode=${state.mode}")
        append(" track=${trackId.telemetryTrackName()}")
        append(" reversed=${reversed ?: "na"}")
        append(" startReached=${startReached ?: "na"}")
        append(" next=${instruction?.command ?: "na"}")
        append(" nextSource=${instruction?.source ?: "na"}")
        append(" nextIndex=${instruction?.trackPointIndex ?: "na"}")
        append(" following=${state.followingInstruction?.command ?: "na"}")
        append(" distToInstructionM=${state.distanceToInstructionMeters.telemetryDistance()}")
        append(" distToFollowingM=${state.distanceToFollowingInstructionMeters.telemetryDistance()}")
        append(" distToStartM=${state.distanceToStartMeters.telemetryDistance()}")
        append(" distToRouteM=${state.distanceToRouteMeters.telemetryDistance()}")
        append(" remainingM=${state.distanceRemainingMeters.telemetryDistance()}")
        append(" progressPct=${state.routeProgressFraction.telemetryPercent()}")
        append(" etaSeconds=${state.estimatedRemainingSeconds ?: "na"}")
        append(" offRoute=${state.offRoute}")
        append(" guideBackPrompt=$showGuideBackPrompt")
        append(" startDecision=${pendingStartDecision ?: "none"}")
        append(" routeStartBehavior=$routeStartBehavior")
        append(" reverseSuggestion=$reverseSuggestionMode")
        append(" offRouteThresholdM=$offRouteThresholdMeters")
        append(" haptics=$hapticsEnabled")
        append(" voice=$voiceGuidanceEnabled")
        append(" turnAlerts=$turnAlertsMode")
        append(" offRouteAlerts=$offRouteAlertsEnabled")
        append(" guidanceGpsAmbient=$guidanceGpsInAmbient")
        append(" activityProfile=$activityProfile")
        append(" resolvedGpsIntervalMs=$resolvedGpsIntervalMs")
        append(" resolvedEtaFlatSpeedMps=${resolvedEtaFlatSpeedMps.telemetrySpeed()}")
        append(" resolvedTurnAlertMaxM=${resolvedTurnAlertMaxDistanceMeters.telemetryDistance()}")
    }
}

internal fun String?.telemetryTrackName(): String =
    this
        ?.substringAfterLast('/')
        ?.take(MAX_TELEMETRY_TRACK_NAME_CHARS)
        ?: "none"

internal fun Double?.telemetryDistance(): String = this?.let { String.format(Locale.US, "%.1f", it) } ?: "na"

internal fun Float.telemetrySpeed(): String = String.format(Locale.US, "%.2f", this)

internal fun Float?.telemetryPercent(): String = this?.let { String.format(Locale.US, "%.1f", it.coerceIn(0f, 1f) * 100f) } ?: "na"

internal fun Double.roundTelemetryMeters(): Int? = if (isFinite()) toInt() else null

internal fun Float.roundTelemetryPercent(): Int? = if (isFinite()) (coerceIn(0f, 1f) * 100f).toInt() else null

internal enum class GuidanceStartDecision {
    START_HERE,
    REVERSE_ROUTE,
}

internal const val START_HERE_MIN_PROGRESS_METERS = 50.0
internal const val START_HERE_MIN_REMAINING_METERS = 50.0
internal const val START_HERE_STABLE_SAMPLE_COUNT = 2
internal const val START_HERE_MAX_ACCURACY_METERS = 60f
internal const val REVERSE_SUGGESTION_DISTANCE_MARGIN_METERS = 50.0
internal const val REVERSE_SUGGESTION_MAX_DISTANCE_METERS = 300.0
private const val MAX_TELEMETRY_TRACK_NAME_CHARS = 48
private const val MAP_ZOOM_LATITUDE_UPDATE_THRESHOLD_DEGREES = 0.25
