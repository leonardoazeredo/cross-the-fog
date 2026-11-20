package codes.madera.crossfog.watch.presentation.features.navigate

import android.content.Context
import android.location.Location
import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import codes.madera.crossfog.watch.R
import codes.madera.crossfog.watch.core.service.diagnostics.DebugTelemetry
import codes.madera.crossfog.watch.core.service.diagnostics.RecordingScreenOffDiagnostics
import codes.madera.crossfog.watch.data.repository.SettingsRepository
import codes.madera.crossfog.watch.presentation.features.gpx.GpxEtaModelConfig
import codes.madera.crossfog.watch.presentation.features.gpx.GpxViewModel
import codes.madera.crossfog.watch.presentation.features.gpx.buildRouteEtaProjection
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.GpxGuidanceSession
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.GpxGuidanceTuning
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.GuidanceMode
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.GuidanceOffRouteConfirmationState
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.TurnByTurnGuidanceState
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.computeTurnByTurnGuidanceState
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.haversineMeters
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.isGuidanceStartReached
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.projectLocationToRoute
import codes.madera.crossfog.watch.presentation.features.navigate.guidance.updateGuidanceOffRouteConfirmation
import org.mapsforge.core.model.LatLong

internal data class NavigateGuidanceRuntime(
    val state: TurnByTurnGuidanceState,
    val showGuideBackPrompt: Boolean,
    val startDecisionPrompt: GuidanceDecisionPrompt?,
    val onDismissGuideBackPrompt: () -> Unit,
    val onAcceptStartDecisionPrompt: () -> Unit,
    val onDismissStartDecisionPrompt: () -> Unit,
)

private const val OFF_ROUTE_WAKE_GRACE_MS = 5_000L

@Composable
internal fun rememberNavigateGuidanceRuntime(
    context: Context,
    gpxViewModel: GpxViewModel,
    activeSession: GpxGuidanceSession?,
    session: GpxGuidanceSession?,
    paused: Boolean,
    rawCurrentLocation: Location?,
    recenterTarget: LatLong?,
    offlineMode: Boolean,
    routeStartBehavior: String,
    reverseSuggestionMode: String,
    offRouteThresholdMeters: Int,
    hapticsEnabled: Boolean,
    voiceGuidanceEnabled: Boolean,
    turnAlertsMode: String,
    offRouteAlertsEnabled: Boolean,
    offRouteRepeatSeconds: Int,
    guidanceGpsInAmbient: Boolean,
    lastScreenResumeElapsedMs: Long,
    isMetric: Boolean,
    activityProfile: String,
    userWeightKg: Float,
    backpackWeightKg: Float,
    bikeWeightKg: Float,
    recordingActive: Boolean,
    recordingSampleIntervalSeconds: Int,
    gpxFlatSpeedMps: Float,
    gpxAdvancedEtaEnabled: Boolean,
    gpxStaminaAdjustmentEnabled: Boolean,
    gpxUphillVerticalMetersPerHour: Float,
    gpxDownhillVerticalMetersPerHour: Float,
): NavigateGuidanceRuntime {
    val guidanceLocation: LatLong? =
        if (offlineMode) {
            null
        } else {
            rawCurrentLocation?.let { location ->
                LatLong(location.latitude, location.longitude)
            } ?: recenterTarget
        }
    val tuning =
        remember(offRouteThresholdMeters) {
            GpxGuidanceTuning(
                offRouteDistanceMeters = offRouteThresholdMeters.toDouble(),
            )
        }
    var previousGuidanceProgressMeters by
        remember(activeSession?.trackId, activeSession?.reversed) {
            mutableStateOf<Double?>(null)
        }
    val guidanceGeometryCache = remember { NavigateGuidanceGeometryCache() }
    val rawState =
        guidanceGeometryCache.primaryState(
            session = activeSession,
            currentLocation = guidanceLocation,
            tuning = tuning,
            previousDistanceFromStartMeters = previousGuidanceProgressMeters,
        ) {
            computeTurnByTurnGuidanceState(
                session = activeSession,
                currentLocation = guidanceLocation,
                tuning = tuning,
                previousDistanceFromStartMeters = previousGuidanceProgressMeters,
            ).also { computedState ->
                computedState.projectionSegmentsScanned?.let { segmentsScanned ->
                    RecordingScreenOffDiagnostics.recordTbtProjection(segmentsScanned)
                }
            }
        }
    LaunchedEffect(activeSession?.trackId, activeSession?.reversed, rawState.distanceFromStartMeters) {
        rawState.distanceFromStartMeters?.let { previousGuidanceProgressMeters = it }
    }
    var offRouteConfirmation by
        remember(activeSession?.trackId, activeSession?.reversed) {
            mutableStateOf(GuidanceOffRouteConfirmationState())
        }
    val etaModelConfig =
        remember(
            gpxFlatSpeedMps,
            gpxAdvancedEtaEnabled,
            gpxStaminaAdjustmentEnabled,
            activityProfile,
            userWeightKg,
            backpackWeightKg,
            bikeWeightKg,
            gpxUphillVerticalMetersPerHour,
            gpxDownhillVerticalMetersPerHour,
        ) {
            GpxEtaModelConfig(
                flatSpeedMps = gpxFlatSpeedMps.toDouble(),
                advancedVerticalRateEnabled = gpxAdvancedEtaEnabled,
                staminaAdjustmentEnabled = gpxStaminaAdjustmentEnabled,
                activityProfile = activityProfile,
                userWeightKg = userWeightKg.toDouble(),
                backpackWeightKg = backpackWeightKg.toDouble(),
                bikeWeightKg = bikeWeightKg.toDouble(),
                uphillVerticalMetersPerHour = gpxUphillVerticalMetersPerHour.toDouble(),
                downhillVerticalMetersPerHour = gpxDownhillVerticalMetersPerHour.toDouble(),
            )
        }
    val routeEtaProjection =
        remember(
            activeSession?.trackId,
            activeSession?.reversed,
            activeSession?.trackPoints,
            etaModelConfig,
        ) {
            activeSession?.let { currentSession ->
                buildRouteEtaProjection(
                    trackPoints = currentSession.trackPoints,
                    config = etaModelConfig,
                )
            }
        }
    val estimatedRemainingSeconds =
        if (rawState.mode == GuidanceMode.FOLLOW_ROUTE) {
            routeEtaProjection?.remainingSecondsAtDistance(rawState.distanceFromStartMeters)
        } else {
            null
        }
    val currentAltitudeMeters =
        rawCurrentLocation
            ?.takeIf { it.hasAltitude() && it.altitude.isFinite() }
            ?.altitude
    val guidanceGpsDeliveryIntervalMs =
        rememberGuidanceGpsDeliveryIntervalMs(
            sessionKey = activeSession?.let { "${it.trackId}:${it.reversed}" },
            locationElapsedRealtimeNanos = rawCurrentLocation?.elapsedRealtimeNanos,
            fallbackIntervalMs =
                expectedGuidanceGpsIntervalMs(
                    recordingActive = recordingActive,
                    recordingSampleIntervalSeconds = recordingSampleIntervalSeconds,
                ),
        )
    LaunchedEffect(
        activeSession?.trackId,
        activeSession?.reversed,
        rawCurrentLocation?.elapsedRealtimeNanos,
        rawCurrentLocation?.time,
        rawState.distanceToRouteMeters,
        offRouteThresholdMeters,
        lastScreenResumeElapsedMs,
    ) {
        if (activeSession == null || rawState.mode != GuidanceMode.FOLLOW_ROUTE) {
            offRouteConfirmation = GuidanceOffRouteConfirmationState()
            return@LaunchedEffect
        }
        if (rawCurrentLocation == null) return@LaunchedEffect
        offRouteConfirmation =
            updateGuidanceOffRouteConfirmation(
                previous = offRouteConfirmation,
                distanceToRouteMeters = rawState.distanceToRouteMeters,
                thresholdMeters = offRouteThresholdMeters.toDouble(),
                allowOffRouteEntry =
                    SystemClock.elapsedRealtime() - lastScreenResumeElapsedMs >=
                        OFF_ROUTE_WAKE_GRACE_MS,
            )
    }
    val state =
        rawState.copy(
            offRoute = offRouteConfirmation.offRoute,
            estimatedRemainingSeconds = estimatedRemainingSeconds,
            currentAltitudeMeters = currentAltitudeMeters,
            alertSessionKey = activeSession?.let { "${it.trackId}:${it.reversed}" },
            alertGpsDeliveryIntervalMs = guidanceGpsDeliveryIntervalMs,
        )
    var dismissedGuideBackPromptTrackId by remember { mutableStateOf<String?>(null) }
    val guideBackTrackId = activeSession?.trackId
    LaunchedEffect(
        state.active,
        state.offRoute,
        guideBackTrackId,
    ) {
        if (!state.active || !state.offRoute) {
            dismissedGuideBackPromptTrackId = null
        }
    }
    var latestActiveDisplayState by
        remember(session?.trackId, session?.reversed) {
            mutableStateOf<TurnByTurnGuidanceState?>(null)
        }
    LaunchedEffect(paused, state) {
        if (!paused && state.active) {
            latestActiveDisplayState = state
        }
    }
    val displayState =
        pausedGuidanceDisplayState(
            currentState = state,
            latestActiveState = latestActiveDisplayState,
            paused = paused,
        )
    val showGuideBackPrompt =
        state.active &&
            state.offRoute &&
            dismissedGuideBackPromptTrackId != guideBackTrackId
    var pendingStartDecision by remember { mutableStateOf<GuidanceStartDecision?>(null) }
    var dismissedStartDecisionKey by remember { mutableStateOf<String?>(null) }
    var startHereStableSampleCount by remember { mutableStateOf(0) }
    val startDecisionKey =
        pendingStartDecision?.let { decision ->
            "$guideBackTrackId:${activeSession?.reversed}:$decision"
        }
    val startDecisionPrompt =
        pendingStartDecision?.let { decision ->
            when (decision) {
                GuidanceStartDecision.REVERSE_ROUTE ->
                    GuidanceDecisionPrompt(
                        title = stringResource(R.string.navigate_closer_to_end),
                        detail = stringResource(R.string.navigate_follow_gpx_in_reverse),
                        acceptText = stringResource(R.string.navigate_reverse),
                        dismissText = stringResource(R.string.common_start),
                    )
                GuidanceStartDecision.START_HERE ->
                    GuidanceDecisionPrompt(
                        title = stringResource(R.string.navigate_on_route),
                        detail = stringResource(R.string.navigate_start_from_nearest_point),
                        acceptText = stringResource(R.string.common_start),
                        dismissText = stringResource(R.string.navigate_gpx_start),
                    )
            }
        }

    LaunchedEffect(
        activeSession,
        guidanceLocation,
        rawCurrentLocation?.accuracy,
        routeStartBehavior,
        reverseSuggestionMode,
        offRouteThresholdMeters,
    ) {
        val currentSession = activeSession
        val location = guidanceLocation
        val rawGuidanceLocation =
            rawCurrentLocation?.let { rawLocation ->
                LatLong(rawLocation.latitude, rawLocation.longitude)
            }
        if (currentSession == null || location == null || currentSession.startReached) {
            pendingStartDecision = null
            dismissedStartDecisionKey = null
            startHereStableSampleCount = 0
            return@LaunchedEffect
        }

        val points = currentSession.trackPoints.map { it.latLong }
        val start = points.firstOrNull()
        val end = points.lastOrNull()
        val projection =
            projectLocationToRoute(
                points = points,
                cumulativeDistancesMeters = currentSession.cumulativeDistancesMeters,
                location = location,
            )
        if (start == null || end == null || projection == null) {
            pendingStartDecision = null
            startHereStableSampleCount = 0
            return@LaunchedEffect
        }
        RecordingScreenOffDiagnostics.recordTbtProjection(points.lastIndex)

        val distanceToStart = haversineMeters(location, start)
        val distanceToEnd = haversineMeters(location, end)
        val closeToRoute = projection.distanceToRouteMeters <= offRouteThresholdMeters.toDouble()
        val midRouteCandidate =
            closeToRoute &&
                distanceToStart > tuning.startReachedDistanceMeters &&
                projection.distanceFromStartMeters > START_HERE_MIN_PROGRESS_METERS &&
                currentSession.totalDistanceMeters - projection.distanceFromStartMeters > START_HERE_MIN_REMAINING_METERS
        val locationAccurateEnough =
            rawCurrentLocation?.accuracy?.let { accuracy ->
                accuracy <= START_HERE_MAX_ACCURACY_METERS
            } ?: false
        val hasFreshGpsLocation = rawGuidanceLocation != null
        if (midRouteCandidate && locationAccurateEnough) {
            startHereStableSampleCount += 1
        } else {
            startHereStableSampleCount = 0
        }
        val stableMidRouteCandidate =
            midRouteCandidate &&
                hasFreshGpsLocation &&
                startHereStableSampleCount >= START_HERE_STABLE_SAMPLE_COUNT
        val reverseCandidate =
            !currentSession.reversed &&
                reverseSuggestionMode == SettingsRepository.TURN_BY_TURN_REVERSE_SUGGESTION_ASK &&
                distanceToEnd + REVERSE_SUGGESTION_DISTANCE_MARGIN_METERS < distanceToStart &&
                distanceToEnd <= REVERSE_SUGGESTION_MAX_DISTANCE_METERS

        val nextDecision =
            when {
                reverseCandidate -> GuidanceStartDecision.REVERSE_ROUTE
                stableMidRouteCandidate &&
                    routeStartBehavior == SettingsRepository.TURN_BY_TURN_ROUTE_START_NEAREST_POINT -> {
                    gpxViewModel.markTurnByTurnStartReached()
                    null
                }
                stableMidRouteCandidate &&
                    routeStartBehavior == SettingsRepository.TURN_BY_TURN_ROUTE_START_ASK ->
                    GuidanceStartDecision.START_HERE
                else -> null
            }

        val nextKey = nextDecision?.let { "${currentSession.trackId}:${currentSession.reversed}:$it" }
        pendingStartDecision =
            if (nextKey != null && dismissedStartDecisionKey != nextKey) {
                nextDecision
            } else {
                null
            }
    }

    LaunchedEffect(activeSession, guidanceLocation, tuning) {
        if (isGuidanceStartReached(activeSession, guidanceLocation, tuning)) {
            gpxViewModel.markTurnByTurnStartReached()
        }
    }

    TurnByTurnGuidanceHapticEffect(
        context = context,
        state = state,
        currentSpeedMps = rawCurrentLocation?.speed,
        currentFixTimestampMs = rawCurrentLocation?.time,
        activityProfile = activityProfile,
        hapticsEnabled = hapticsEnabled,
        turnAlertsMode = turnAlertsMode,
        offRouteAlertsEnabled = offRouteAlertsEnabled,
        offRouteRepeatSeconds = offRouteRepeatSeconds,
    )

    TurnByTurnGuidanceVoiceEffect(
        context = context,
        state = state,
        currentSpeedMps = rawCurrentLocation?.speed,
        activityProfile = activityProfile,
        voiceEnabled = voiceGuidanceEnabled,
        turnAlertsMode = turnAlertsMode,
        offRouteAlertsEnabled = offRouteAlertsEnabled,
        offRouteRepeatSeconds = offRouteRepeatSeconds,
        paused = paused,
        isMetric = isMetric,
    )

    LaunchedEffect(
        state.active,
        state.mode,
        state.nextInstruction?.trackPointIndex,
        state.distanceToInstructionMeters?.roundTelemetryMeters(),
        state.distanceToStartMeters?.roundTelemetryMeters(),
        state.distanceToRouteMeters?.roundTelemetryMeters(),
        state.distanceRemainingMeters?.roundTelemetryMeters(),
        state.routeProgressFraction?.roundTelemetryPercent(),
        state.offRoute,
        paused,
        session?.trackId,
        session?.reversed,
        session?.startReached,
        showGuideBackPrompt,
        pendingStartDecision,
        routeStartBehavior,
        reverseSuggestionMode,
        offRouteThresholdMeters,
        hapticsEnabled,
        voiceGuidanceEnabled,
        turnAlertsMode,
        offRouteAlertsEnabled,
        guidanceGpsInAmbient,
        activityProfile,
        recordingActive,
        recordingSampleIntervalSeconds,
        gpxFlatSpeedMps,
    ) {
        if (!state.active && session == null) return@LaunchedEffect
        DebugTelemetry.log("TurnByTurn") {
            buildTurnByTurnTelemetryMessage(
                state = state,
                paused = paused,
                trackId = session?.trackId,
                reversed = session?.reversed,
                startReached = session?.startReached,
                showGuideBackPrompt = showGuideBackPrompt,
                pendingStartDecision = pendingStartDecision,
                routeStartBehavior = routeStartBehavior,
                reverseSuggestionMode = reverseSuggestionMode,
                offRouteThresholdMeters = offRouteThresholdMeters,
                hapticsEnabled = hapticsEnabled,
                voiceGuidanceEnabled = voiceGuidanceEnabled,
                turnAlertsMode = turnAlertsMode,
                offRouteAlertsEnabled = offRouteAlertsEnabled,
                guidanceGpsInAmbient = guidanceGpsInAmbient,
                activityProfile = activityProfile,
                resolvedGpsIntervalMs = guidanceGpsDeliveryIntervalMs,
                resolvedEtaFlatSpeedMps = gpxFlatSpeedMps,
                resolvedTurnAlertMaxDistanceMeters = turnAlertMaxDistanceMeters(activityProfile),
            )
        }
    }

    return NavigateGuidanceRuntime(
        state = displayState,
        showGuideBackPrompt = showGuideBackPrompt,
        startDecisionPrompt = startDecisionPrompt,
        onDismissGuideBackPrompt = {
            dismissedGuideBackPromptTrackId = guideBackTrackId
        },
        onAcceptStartDecisionPrompt = {
            when (pendingStartDecision) {
                GuidanceStartDecision.REVERSE_ROUTE -> gpxViewModel.reverseTurnByTurnGuidance()
                GuidanceStartDecision.START_HERE -> gpxViewModel.markTurnByTurnStartReached()
                null -> Unit
            }
            dismissedStartDecisionKey = startDecisionKey
            pendingStartDecision = null
        },
        onDismissStartDecisionPrompt = {
            dismissedStartDecisionKey = startDecisionKey
            pendingStartDecision = null
        },
    )
}

@Composable
private fun rememberGuidanceGpsDeliveryIntervalMs(
    sessionKey: String?,
    locationElapsedRealtimeNanos: Long?,
    fallbackIntervalMs: Long,
): Long {
    var previousLocationElapsedRealtimeNanos by remember(sessionKey) { mutableStateOf<Long?>(null) }
    var observedIntervalMs by remember(sessionKey) { mutableStateOf(fallbackIntervalMs) }
    LaunchedEffect(sessionKey, locationElapsedRealtimeNanos, fallbackIntervalMs) {
        val currentNanos = locationElapsedRealtimeNanos?.takeIf { it > 0L }
        val previousNanos = previousLocationElapsedRealtimeNanos
        if (currentNanos != null && previousNanos != null && currentNanos > previousNanos) {
            val intervalMs = (currentNanos - previousNanos) / NANOS_PER_MILLISECOND
            if (intervalMs in MIN_OBSERVED_GPS_INTERVAL_MS..MAX_OBSERVED_GPS_INTERVAL_MS) {
                observedIntervalMs = intervalMs
            }
        } else if (previousNanos == null) {
            observedIntervalMs = fallbackIntervalMs
        }
        previousLocationElapsedRealtimeNanos = currentNanos
    }
    return observedIntervalMs
}

private fun expectedGuidanceGpsIntervalMs(
    recordingActive: Boolean,
    recordingSampleIntervalSeconds: Int,
): Long {
    val userIntervalMs = SettingsRepository.DEFAULT_GPS_INTERVAL_MS
    if (!recordingActive) return userIntervalMs
    val recordingIntervalMs =
        if (recordingSampleIntervalSeconds == SettingsRepository.RECORDING_SAMPLE_INTERVAL_DISABLED_SECONDS) {
            Long.MAX_VALUE
        } else {
            recordingSampleIntervalSeconds.coerceAtLeast(1) * 1_000L
        }
    return minOf(userIntervalMs, recordingIntervalMs)
}

private const val NANOS_PER_MILLISECOND = 1_000_000L
private const val MIN_OBSERVED_GPS_INTERVAL_MS = 250L
private const val MAX_OBSERVED_GPS_INTERVAL_MS = 120_000L
