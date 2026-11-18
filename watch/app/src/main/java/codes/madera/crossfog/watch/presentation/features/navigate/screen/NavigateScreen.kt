package codes.madera.crossfog.watch.presentation.features.navigate

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.lifecycle.viewmodel.compose.viewModel
import codes.madera.crossfog.watch.core.service.diagnostics.BenchmarkTrace
import codes.madera.crossfog.watch.core.service.diagnostics.DebugTelemetry
import codes.madera.crossfog.watch.core.service.diagnostics.TerrainDiagnostics
import codes.madera.crossfog.watch.core.service.location.config.AUTO_PAUSE_GPS_INTERVAL_MS
import codes.madera.crossfog.watch.core.service.location.model.LocationScreenState
import codes.madera.crossfog.watch.core.service.location.model.effectiveAccuracyMeters
import codes.madera.crossfog.watch.core.service.location.model.isInteractive
import codes.madera.crossfog.watch.core.service.location.model.isNonInteractive
import codes.madera.crossfog.watch.core.service.location.policy.NavigationRuntimeDemandReason
import codes.madera.crossfog.watch.data.repository.SettingsRepository
import codes.madera.crossfog.watch.domain.sensors.CompassViewModel
import codes.madera.crossfog.watch.presentation.features.gpx.GpxViewModel
import codes.madera.crossfog.watch.presentation.features.maps.DemSetupBottomSheet
import codes.madera.crossfog.watch.presentation.features.maps.DemSetupReason
import codes.madera.crossfog.watch.presentation.features.maps.MapHolder
import codes.madera.crossfog.watch.presentation.features.maps.MapRenderer
import codes.madera.crossfog.watch.presentation.features.maps.MapViewModel
import codes.madera.crossfog.watch.presentation.features.maps.MapZoomChangeAttribution
import codes.madera.crossfog.watch.presentation.features.navigate.effects.NavigateCalibrationEffects
import codes.madera.crossfog.watch.presentation.features.navigate.effects.NavigateCompassEffects
import codes.madera.crossfog.watch.presentation.features.navigate.effects.NavigateCompassWakeTelemetry
import codes.madera.crossfog.watch.presentation.features.navigate.effects.rememberNavigateLocationUiState
import codes.madera.crossfog.watch.presentation.features.recording.TraceRecordingViewModel
import codes.madera.crossfog.watch.presentation.features.settings.SettingsViewModel
import codes.madera.crossfog.watch.presentation.ui.rememberWearAdaptiveSpec
import codes.madera.crossfog.watch.presentation.ui.rememberWearScreenSize
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.mapsforge.core.model.LatLong
import org.mapsforge.map.android.graphics.AndroidBitmap

@Suppress("CyclomaticComplexMethod", "FunctionNaming", "LongMethod", "LongParameterList")
@Composable
fun NavigateScreen(
    mapViewModel: MapViewModel,
    gpxViewModel: GpxViewModel,
    settingsViewModel: SettingsViewModel,
    locationViewModel: LocationViewModel,
    traceRecordingViewModel: TraceRecordingViewModel,
    isAmbient: Boolean,
    isDeviceInteractive: Boolean,
    ambientTickMs: Long,
    onNavigateTimeSuppressedChange: (Boolean) -> Unit = {},
    showNavigateTime: Boolean = true,
    navigateTimeFormat: String = SettingsRepository.TIME_FORMAT_24_HOUR,
    recordingDashboardExpandRequestToken: Long = 0L,
    recordingActionPromptRequestToken: Long = 0L,
    onRecordingTimeTap: () -> Unit = {},
    onRecordingTimeLongPress: () -> Unit = {},
    onMenuClick: () -> Unit,
    onCloseApp: () -> Unit,
    onOpenMapBundles: (LatLong) -> Unit = {},
    compassViewModel: CompassViewModel = viewModel(),
    navigateViewModel: NavigateViewModel = viewModel(),
) {
    val resources = LocalResources.current
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val adaptive = rememberWearAdaptiveSpec()
    val screenSize = rememberWearScreenSize()
    val density = LocalDensity.current
    val focusRequester = remember { FocusRequester() }
    val mapFocusState =
        remember(navigateViewModel) {
            NavigateMapFocusState(initialMapFocusMode = navigateViewModel.mapFocusMode.value)
        }
    SideEffect {
        BenchmarkTrace.mark("recompose.NavigateScreen")
    }
    val lifecycleState = rememberNavigateScreenLifecycleState(isDeviceInteractive = isDeviceInteractive)
    val isScreenResumed = lifecycleState.isScreenResumed
    val lastScreenResumeElapsedMs = lifecycleState.lastScreenResumeElapsedMs
    val menuClickWakeElapsedMs = lifecycleState.menuClickWakeElapsedMs
    val startRecordingWithActivityPermission =
        rememberRecordingStartWithActivityPermission(
            context = context,
            onStartRecording = traceRecordingViewModel::startRecording,
        )
    val menuClickGuardUntilElapsedMs = lifecycleState.menuClickGuardUntilElapsedMs

    // ---- UI STATE ----
    val initialUiState = remember(navigateViewModel) { navigateViewModel.currentStateSnapshot }
    val uiState by navigateViewModel.presentationState.collectAsState(initial = initialUiState)
    val navMode by navigateViewModel.navMode.collectAsState()
    val showCalibrationDialog = uiState.showCalibrationDialog
    val currentZoomLevel = uiState.currentZoomLevel

    // ---- Persisted Keep App Open ----
    val keepAppOpen by settingsViewModel.keepAppOpen.collectAsState()
    val keepAppOpenTipShown by settingsViewModel.keepAppOpenTipShown.collectAsState()
    var pendingKeepAppOpen by rememberSaveable { mutableStateOf(false) }
    var showKeepAppOpenInfoDialog by rememberSaveable { mutableStateOf(false) }
    var showNotificationPermissionDialog by rememberSaveable { mutableStateOf(false) }

    // ---- PERMISSIONS ----
    val notificationPermissionState =
        rememberNotificationPermissionState(context) { granted ->
            if (granted && pendingKeepAppOpen) {
                settingsViewModel.setKeepAppOpen(true)
                pendingKeepAppOpen = false
            } else if (!granted) {
                pendingKeepAppOpen = false
            }
        }

    val locationPermissionState =
        rememberLocationPermissionState(context) { granted ->
            if (granted && pendingKeepAppOpen) {
                if (
                    notificationPermissionState.isPermissionRequired &&
                    !notificationPermissionState.hasNotificationPermission
                ) {
                    showNotificationPermissionDialog = true
                } else {
                    settingsViewModel.setKeepAppOpen(true)
                    pendingKeepAppOpen = false
                }
            } else if (!granted) {
                pendingKeepAppOpen = false
            }
        }
    val notificationPermissionPromptState =
        notificationPermissionState.copy(
            launchPermissionRequest = { showNotificationPermissionDialog = true },
        )

    val hillshadeTerrainUnavailableEvent by mapViewModel.hillshadeTerrainUnavailableEvent.collectAsState()
    LaunchedEffect(hillshadeTerrainUnavailableEvent?.correlationId) {
        hillshadeTerrainUnavailableEvent?.let { event ->
            TerrainDiagnostics.record(
                event = "terrain_popup_shown",
                detail =
                    "correlationId=${event.correlationId} map=${event.mapIdentity} " +
                        "zoom=${event.zoomLevel} missingTiles=${event.missingTileCount}",
            )
        }
    }
    DemSetupBottomSheet(
        visible = hillshadeTerrainUnavailableEvent != null,
        reason = DemSetupReason.HILL_SHADING_VISIBLE_AREA,
        onDismiss = mapViewModel::dismissHillshadeTerrainUnavailable,
    )

    // ---- SETTINGS ----
    val navigateSettings = collectNavigateSettingsState(settingsViewModel)
    with<NavigateSettingsState, Unit>(navigateSettings) {
        // ---- VMS ----
        val selectedMapPath by mapViewModel.selectedMapPath.collectAsState()
        val installedMapBounds by mapViewModel.installedMapBounds.collectAsState()
        val missingMapPromptDisabled by mapViewModel.missingMapPromptDisabled.collectAsState()
        val missingMapPromptDismissed by mapViewModel.missingMapPromptDismissed.collectAsState()
        val activeGpxDetails by gpxViewModel.activeGpxDetails.collectAsState()
        val turnByTurnGuidanceSession by gpxViewModel.turnByTurnGuidanceSession.collectAsState()
        val turnByTurnGuidancePaused by gpxViewModel.turnByTurnGuidancePaused.collectAsState()
        val activeTurnByTurnGuidanceSession =
            if (turnByTurnGuidancePaused) {
                null
            } else {
                turnByTurnGuidanceSession
            }
        val effectiveNavigationMarkerAnchorMode =
            if (turnByTurnGuidanceSession != null) {
                SettingsRepository.NAVIGATION_MARKER_ANCHOR_LOWER
            } else {
                navigationMarkerAnchorMode
            }
        val traceRecordingState by traceRecordingViewModel.recordingPresentationState.collectAsState()
        val recordingSampleIntervalSeconds by settingsViewModel.recordingSampleIntervalSeconds.collectAsState()
        val recordingScreenOffSampleIntervalSeconds by settingsViewModel.recordingScreenOffSampleIntervalSeconds
            .collectAsState()
        val turnByTurnGpsIntervalSeconds by settingsViewModel.turnByTurnGpsIntervalSeconds.collectAsState()
        val turnByTurnScreenOffGpsIntervalSeconds by settingsViewModel.turnByTurnScreenOffGpsIntervalSeconds
            .collectAsState()
        val recordingScreenOnGpsEnabled =
            recordingSampleIntervalSeconds != SettingsRepository.RECORDING_SAMPLE_INTERVAL_DISABLED_SECONDS
        val recordingScreenOffGpsEnabled =
            when (recordingScreenOffSampleIntervalSeconds) {
                SettingsRepository.GPS_INTERVAL_SAME_AS_SCREEN_ON_SECONDS -> recordingScreenOnGpsEnabled
                SettingsRepository.RECORDING_SAMPLE_INTERVAL_DISABLED_SECONDS -> false
                else -> true
            }
        val turnByTurnScreenOnGpsEnabled =
            turnByTurnGpsIntervalSeconds != SettingsRepository.RECORDING_SAMPLE_INTERVAL_DISABLED_SECONDS
        val turnByTurnScreenOffGpsEnabled =
            when (turnByTurnScreenOffGpsIntervalSeconds) {
                SettingsRepository.GPS_INTERVAL_SAME_AS_SCREEN_ON_SECONDS -> turnByTurnScreenOnGpsEnabled
                SettingsRepository.RECORDING_SAMPLE_INTERVAL_DISABLED_SECONDS -> false
                else -> true
            }
        val recordingStatusMessage =
            rememberRecordingStatusMessage(
                state = traceRecordingState,
                traceRecordingViewModel = traceRecordingViewModel,
            )

        val mapZoomState =
            rememberNavigateMapZoomState(
                configuration = configuration,
                density = density,
                zoomDefaultScaleMeters = zoomDefaultScaleMeters,
                zoomMinScaleMeters = zoomMinScaleMeters,
                zoomMaxScaleMeters = zoomMaxScaleMeters,
            )
        val zoomDefault = mapZoomState.default
        val zoomMin = mapZoomState.min
        val zoomMax = mapZoomState.max

        // Inspection UI state
        val inspectionUiState by gpxViewModel.inspectionUiState.collectAsState()

        // A/B marker points
        val selectedPointA by gpxViewModel.selectedPointA.collectAsState()
        val selectedPointB by gpxViewModel.selectedPointB.collectAsState()
        val selectingGpxPointB by gpxViewModel.selectingPointB.collectAsState()
        var shortcutTrayExpanded by rememberSaveable { mutableStateOf(false) }
        val scope = rememberCoroutineScope()

        // ---- Should track location? ----
        val runtimeState =
            rememberNavigateRuntimeState(
                isAmbient = isAmbient,
                isDeviceInteractive = isDeviceInteractive,
                isScreenResumed = isScreenResumed,
                hasLocationPermission = locationPermissionState.hasLocationPermission,
                offlineMode = offlineMode,
                generalGpsInAmbient = keepGpsInAmbient,
                traceRecordingState = traceRecordingState,
                recordingScreenOnGpsEnabled = recordingScreenOnGpsEnabled,
                recordingScreenOffGpsEnabled = recordingScreenOffGpsEnabled,
                turnByTurnScreenOnGpsEnabled = turnByTurnScreenOnGpsEnabled,
                turnByTurnScreenOffGpsEnabled = turnByTurnScreenOffGpsEnabled,
                turnByTurnActive = turnByTurnGuidanceSession != null,
                turnByTurnPaused = turnByTurnGuidancePaused,
                turnByTurnGpsInAmbient = turnByTurnScreenOffGpsEnabled,
                locationViewModel = locationViewModel,
            )
        val screenState = runtimeState.screenState
        val shouldTrackLocation = runtimeState.shouldTrackLocation
        val configuredMarkerGpsIntervalMs =
            remember(
                runtimeState.reason,
                screenState,
                recordingSampleIntervalSeconds,
                recordingScreenOffSampleIntervalSeconds,
                turnByTurnGpsIntervalSeconds,
                turnByTurnScreenOffGpsIntervalSeconds,
            ) {
                expectedMarkerGpsIntervalMs(
                    runtimeReason = runtimeState.reason,
                    screenState = screenState,
                    recordingSampleIntervalSeconds = recordingSampleIntervalSeconds,
                    recordingScreenOffSampleIntervalSeconds = recordingScreenOffSampleIntervalSeconds,
                    turnByTurnGpsIntervalSeconds = turnByTurnGpsIntervalSeconds,
                    turnByTurnScreenOffGpsIntervalSeconds = turnByTurnScreenOffGpsIntervalSeconds,
                )
            }
        val serviceEffectiveGpsIntervalMs by locationViewModel.effectiveGpsIntervalMs.collectAsState()
        val expectedMarkerGpsIntervalMs =
            resolveMarkerGpsIntervalMs(
                serviceEffectiveIntervalMs = serviceEffectiveGpsIntervalMs,
                configuredIntervalMs = configuredMarkerGpsIntervalMs,
            )
        val effectiveNavMode = if (offlineMode) NavMode.PANNING else navMode
        // ---- Heading + Accuracy ----
        val compassUiState =
            rememberNavigateCompassUiState(
                compassViewModel = compassViewModel,
                screenState = screenState,
                isScreenResumed = isScreenResumed,
                offlineMode = offlineMode,
                northReferenceMode = northReferenceMode,
                compassProviderMode = compassProviderMode,
                headingSourceMode = headingSourceMode,
                navigationMarkerStyleSetting = navigationMarkerStyleSetting,
                compassConeAccuracyColorsEnabled = compassConeAccuracyColorsEnabled,
                density = density,
                screenSize = screenSize,
            )
        val compassRenderState = compassUiState.renderState
        val compassAccuracy = compassUiState.accuracy
        val magneticInterference = compassUiState.magneticInterference
        val selectedCompassProviderType = compassUiState.providerType
        val navigationMarkerStyle = compassUiState.markerStyle
        val navigationMarkerSizePx = compassUiState.markerSizePx
        val showCompassConeOverlay = compassUiState.showCompassConeOverlay
        val compassConeBaseSizePx = compassUiState.coneBaseSizePx
        val compassConeQuality = compassUiState.coneQuality
        val compassConeHeadingErrorDeg = compassUiState.coneHeadingErrorDeg

        // ---- MAP OBJECTS ----
        val mapHolder: MapHolder =
            remember(zoomDefault, zoomMin, zoomMax) {
                mapViewModel.getOrCreateMapHolder(
                    context = context,
                    zoomDefault = zoomDefault,
                    zoomMin = zoomMin,
                    zoomMax = zoomMax,
                )
            }

        LaunchedEffect(mapHolder) {
            mapViewModel.setMapRenderer(mapHolder.renderer)
        }

        LaunchedEffect(mapHolder, selectedMapPath) {
            val mapView = mapHolder.mapView
            val center = mapView.model.mapViewPosition.center
            mapZoomState.updateReference(center, mapView.width)
        }

        LaunchedEffect(mapHolder, northReferenceMode) {
            if (northReferenceMode != SettingsRepository.NORTH_REFERENCE_TRUE) return@LaunchedEffect
            val center = mapHolder.mapView.model.mapViewPosition.center
            compassViewModel.primeDeclinationFromApproximateLocation(
                latitude = center.latitude,
                longitude = center.longitude,
            )
        }

        val navigationMarkerBitmap =
            remember(navigationMarkerStyle, navigationMarkerSizePx) {
                val bitmap =
                    createNavigationMarkerBitmap(
                        style = navigationMarkerStyle,
                        sizePx = navigationMarkerSizePx,
                    )
                AndroidBitmap(bitmap)
            }
        val historicalNavigationMarkerBitmap =
            remember(navigationMarkerStyle, navigationMarkerSizePx) {
                AndroidBitmap(
                    createNavigationMarkerBitmap(
                        style = navigationMarkerStyle,
                        sizePx = navigationMarkerSizePx,
                        fillColor = NAVIGATION_MARKER_HISTORICAL_ARGB,
                    ),
                )
            }
        DisposableEffect(navigationMarkerBitmap, historicalNavigationMarkerBitmap) {
            onDispose {
                navigationMarkerBitmap.decrementRefCount()
                historicalNavigationMarkerBitmap.decrementRefCount()
            }
        }

        NavigateCompassEffects(
            compassViewModel = compassViewModel,
            compassProviderType = selectedCompassProviderType,
            screenState = screenState,
            isOfflineMode = offlineMode,
        )

        // In follow modes, keep user location centered at all times.
        // autoRecenterEnabled only controls whether we exit panning automatically.
        val shouldFollowPosition = effectiveNavMode != NavMode.PANNING

        // Ensure zoom initialised once
        LaunchedEffect(zoomDefault) {
            navigateViewModel.initZoom(zoomDefault)
        }

        NavigateCalibrationEffects(
            compassViewModel = compassViewModel,
            compassProviderType = selectedCompassProviderType,
            compassAccuracy = compassAccuracy,
            magneticInterference = magneticInterference,
            navMode = effectiveNavMode,
            isAmbient = isAmbient,
            promptForCalibration = promptForCalibration,
            showCalibrationDialog = showCalibrationDialog,
            onShowCalibrationDialog = { navigateViewModel.setCalibrationDialogVisible(true) },
            onHideCalibrationDialog = { navigateViewModel.setCalibrationDialogVisible(false) },
            onApplyRecalibration = { compassViewModel.recalibrate() },
            onRecalibrationSucceeded = compassUiState.onCalibrationSucceeded,
        )

        val screenActions =
            rememberNavigateScreenActions(
                context = context,
                settingsViewModel = settingsViewModel,
                locationPermissionState = locationPermissionState,
                notificationPermissionState = notificationPermissionPromptState,
                keepAppOpen = keepAppOpen,
                keepAppOpenTipShown = keepAppOpenTipShown,
                offlineMode = offlineMode,
                setPendingKeepAppOpen = { pendingKeepAppOpen = it },
                setShowKeepAppOpenInfoDialog = { showKeepAppOpenInfoDialog = it },
                setShortcutTrayExpanded = { shortcutTrayExpanded = it },
                isShortcutTrayExpanded = shortcutTrayExpanded,
            )

        fun enterMapFocus() {
            screenActions.triggerHaptic()
            mapFocusState.enter { shortcutTrayExpanded = false }
            navigateViewModel.mapFocusMode.value = true
            DebugTelemetry.log("NavigationTelemetry", "event=map_focus_enter source=shortcut")
        }

        fun exitMapFocus(source: String) {
            if (!mapFocusState.mapFocusMode) return
            if (source == "button") screenActions.triggerHaptic()
            shortcutTrayExpanded = false
            mapFocusState.exit()
            navigateViewModel.mapFocusMode.value = false
            DebugTelemetry.log("NavigationTelemetry", "event=map_focus_exit source=$source")
        }

        // ---- Auto-recenter timer ----
        LaunchedEffect(effectiveNavMode, autoRecenterEnabled, autoRecenterDelay, offlineMode) {
            if (!offlineMode && effectiveNavMode == NavMode.PANNING && autoRecenterEnabled) {
                delay(autoRecenterDelay.toLong() * 1000L)
                navigateViewModel.onRecenterRequested()
            }
        }

        if (isAmbient) {
            AmbientScreen(
                ambientTick = ambientTickMs,
                timeFormat = navigateTimeFormat,
            )
            return
        }

        val mapView = mapHolder.mapView

        val locationUiState =
            rememberNavigateLocationUiState(
                mapView = mapView,
                locationViewModel = locationViewModel,
                compassViewModel = compassViewModel,
                navigateViewModel = navigateViewModel,
                shouldTrackLocation = shouldTrackLocation,
                shouldFollowPosition = shouldFollowPosition,
                screenState = screenState,
                expectedGpsIntervalMs = expectedMarkerGpsIntervalMs,
                markerTrustExpectedGpsIntervalMs = configuredMarkerGpsIntervalMs,
                isBikeActivityProfile = activityProfile == SettingsRepository.ACTIVITY_PROFILE_BIKE,
                navigationMarkerBitmap = navigationMarkerBitmap,
                historicalNavigationMarkerBitmap = historicalNavigationMarkerBitmap,
                retainedLocationAnchor = navigateViewModel.currentStateSnapshot.retainedLocationAnchor,
                suppressLocationMarker = offlineMode,
                navigationMarkerAnchorMode = effectiveNavigationMarkerAnchorMode,
            )

        val locationMarker = locationUiState.locationMarker
        val gpsIndicatorState = locationUiState.gpsIndicatorState
        val effectiveGpsIndicatorState =
            if (offlineMode) {
                GpsFixIndicatorState.UNAVAILABLE
            } else {
                gpsIndicatorState
            }
        val gpsSignalSnapshot by locationViewModel.gpsSignalSnapshot.collectAsState()
        val rawCurrentLocation by locationViewModel.currentLocation.collectAsState()
        val gpsFixFreshForAccuracyCircle =
            locationUiState.locationMarkerTrustState == LocationMarkerTrustState.CURRENT
        val watchGpsDegradedWarning = locationUiState.watchGpsDegradedWarning
        val gpsEnvironmentWarning = locationUiState.gpsEnvironmentWarning
        val mapAppearanceApplyInProgress by mapViewModel.mapAppearanceApplyInProgress.collectAsState()
        val slopeOverlayToggleEnabled by mapViewModel.reliefOverlayToggleEnabled.collectAsState()
        var slopeOverlayState by remember {
            mutableStateOf(
                MapRenderer.ReliefOverlayState(
                    enabled = false,
                    processing = false,
                    progressPercent = null,
                ),
            )
        }

        DisposableEffect(mapHolder) {
            val listener: (MapRenderer.ReliefOverlayState) -> Unit = { state ->
                slopeOverlayState = state
            }
            mapHolder.renderer.addReliefOverlayStateListener(listener)
            onDispose {
                mapHolder.renderer.removeReliefOverlayStateListener(listener)
            }
        }

        // All overlays + popups + yellow A/B markers
        var renderedMapRotationDeg by remember { mutableFloatStateOf(0f) }
        var renderedCompassHeadingDeg by
            remember {
                mutableFloatStateOf(
                    resolveNavigateInitialRenderedHeadingDeg(
                        renderState = compassRenderState,
                        nowElapsedMs = SystemClock.elapsedRealtime(),
                    ),
                )
            }
        val markerMotionDebugOverlayRefreshEnabled =
            shouldRefreshMarkerMotionDebugOverlay(
                gpsDebugTelemetry = gpsDebugTelemetry,
                gpsDebugTelemetryPopupEnabled = gpsDebugTelemetryPopupEnabled,
                offlineMode = offlineMode,
                screenState = screenState,
            )
        val markerMotionDebugOverlayLabel =
            rememberMarkerMotionDebugOverlayLabel(
                refreshEnabled = markerMotionDebugOverlayRefreshEnabled,
                renderState = compassRenderState,
                renderedHeadingDeg = renderedCompassHeadingDeg,
            )
        MapOverlays(
            mapViewModel = mapViewModel,
            mapHolder = mapHolder,
            activeGpxDetails = activeGpxDetails,
            recordingTraceState = traceRecordingState,
            recordingTraceFollowsMarker = traceRecordingState.active && !traceRecordingState.paused,
            gpxTrackColor = gpxTrackColor,
            gpxTrackColorMode = gpxTrackColorMode,
            gpxTrackWidth = gpxTrackWidth,
            gpxTrackOpacityPercent = gpxTrackOpacityPercent,
            gpxTrackDirectionArrowsEnabled = gpxTrackDirectionArrowsEnabled,
            compassRenderStateFlow = compassViewModel.renderState,
            compassInteractive = isScreenResumed && screenState.isInteractive && !offlineMode,
            navMode = effectiveNavMode,
            forceNorthUpInPanning = offlineMode,
            showRealMarkerInCompassMode = true,
            showCompassConeOverlay = showCompassConeOverlay,
            compassConeBaseSizePx = compassConeBaseSizePx,
            compassQuality = compassConeQuality,
            compassHeadingErrorDeg = compassConeHeadingErrorDeg,
            gpsAccuracyCircleEnabled = gpsAccuracyCircleEnabled && !offlineMode,
            gpsFixAccuracyM = gpsSignalSnapshot.effectiveAccuracyMeters(),
            gpsFixFresh = gpsFixFreshForAccuracyCircle,
            gpsFixSpeedMps = locationUiState.lastFixSpeedMps,
            gpsFixBearingDeg = locationUiState.lastFixBearingDeg,
            renderedHeadingDeg = renderedCompassHeadingDeg,
            locationMarker = locationMarker,
            navigationMarkerAnchorMode = effectiveNavigationMarkerAnchorMode,
            inspectionUiState = inspectionUiState,
            selectedPointA = selectedPointA,
            selectedPointB = selectedPointB,
            onDismissInspection = { gpxViewModel.dismissInspection() },
            onStartSelectB = { gpxViewModel.startSelectingB() },
            isMetric = isMetric,
            onRenderedHeadingChanged = { renderedCompassHeadingDeg = it },
            onRenderedMapRotationChanged = { renderedMapRotationDeg = it },
        )
        NavigateCompassWakeTelemetry(
            isScreenResumed = isScreenResumed,
            screenState = screenState,
            isOfflineMode = offlineMode,
            renderState = compassRenderState,
            renderedHeadingDeg = renderedCompassHeadingDeg,
            renderedMapRotationDeg = renderedMapRotationDeg,
        )

        NavigateBackHandler(
            mapFocusMode = mapFocusState.mapFocusMode,
            onExitMapFocus = { exitMapFocus("back") },
            shortcutTrayExpanded = shortcutTrayExpanded,
            backButtonExitsNavigation = backButtonExitsNavigation,
            backButtonClosesApp = backButtonClosesApp,
            onCloseApp = onCloseApp,
            onDismissShortcutTray = { shortcutTrayExpanded = false },
            onMenuClick = onMenuClick,
        )

        val startupCentering =
            NavigateStartupCenteringEffects(
                offlineMode = offlineMode,
                shouldTrackLocation = shouldTrackLocation,
                shouldFollowPosition = shouldFollowPosition,
                isScreenInteractive = isScreenResumed && screenState.isInteractive,
                startupLocation = rawCurrentLocation,
                gpsSignalSnapshot = gpsSignalSnapshot,
                locationMarkerLatLong = locationMarker?.latLong,
                lastKnownLocation = uiState.lastKnownLocation,
                retainedLocationAnchor = navigateViewModel.currentStateSnapshot.retainedLocationAnchor,
                startupMapFallbackState = uiState.startupMapFallbackState,
                onStartupMapFallbackEvent = navigateViewModel::onStartupMapFallbackEvent,
                mapView = mapView,
                mapViewModel = mapViewModel,
                selectedMapPath = selectedMapPath,
                activeGpxDetails = activeGpxDetails,
            )
        val recenterTarget = startupCentering.recenterTarget
        val guidanceRuntime =
            rememberNavigateGuidanceRuntime(
                context = context,
                gpxViewModel = gpxViewModel,
                activeSession = activeTurnByTurnGuidanceSession,
                session = turnByTurnGuidanceSession,
                paused = turnByTurnGuidancePaused,
                rawCurrentLocation = rawCurrentLocation,
                recenterTarget = recenterTarget,
                offlineMode = offlineMode,
                routeStartBehavior = turnByTurnRouteStartBehavior,
                reverseSuggestionMode = turnByTurnReverseSuggestionMode,
                offRouteThresholdMeters = turnByTurnOffRouteThresholdMeters,
                hapticsEnabled = turnByTurnHapticsEnabled,
                voiceGuidanceEnabled = turnByTurnVoiceGuidanceEnabled,
                turnAlertsMode = turnByTurnTurnAlertsMode,
                offRouteAlertsEnabled = turnByTurnOffRouteAlertsEnabled,
                offRouteRepeatSeconds = turnByTurnOffRouteRepeatSeconds,
                guidanceGpsInAmbient = turnByTurnGpsInAmbient,
                brouterGuideBackEnabled = true,
                lastScreenResumeElapsedMs = lastScreenResumeElapsedMs,
                isMetric = isMetric,
                activityProfile = activityProfile,
                userWeightKg = userWeightKg,
                backpackWeightKg = backpackWeightKg,
                bikeWeightKg = bikeWeightKg,
                recordingActive = traceRecordingState.active,
                recordingSampleIntervalSeconds = recordingSampleIntervalSeconds,
                gpxFlatSpeedMps = gpxFlatSpeedMps,
                gpxAdvancedEtaEnabled = gpxAdvancedEtaEnabled,
                gpxStaminaAdjustmentEnabled = gpxStaminaAdjustmentEnabled,
                gpxUphillVerticalMetersPerHour = gpxUphillVerticalMetersPerHour,
                gpxDownhillVerticalMetersPerHour = gpxDownhillVerticalMetersPerHour,
            )
        val adaptiveTurnByTurnScreenOffIntervalMs =
            if (
                turnByTurnScreenOffGpsIntervalSeconds ==
                SettingsRepository.GPS_INTERVAL_ADAPTIVE_SCREEN_OFF_SECONDS &&
                screenState.isNonInteractive &&
                activeTurnByTurnGuidanceSession != null
            ) {
                resolveAdaptiveTurnByTurnScreenOffIntervalMs(
                    state = guidanceRuntime.state,
                    currentSpeedMps = rawCurrentLocation?.speed,
                    activityProfile = activityProfile,
                )
            } else {
                null
            }
        LaunchedEffect(adaptiveTurnByTurnScreenOffIntervalMs) {
            locationViewModel.setTurnByTurnScreenOffIntervalOverride(
                intervalMs = adaptiveTurnByTurnScreenOffIntervalMs,
            )
        }
        DisposableEffect(locationViewModel) {
            onDispose {
                locationViewModel.setTurnByTurnScreenOffIntervalOverride(intervalMs = null)
            }
        }

        LaunchedEffect(
            effectiveNavigationMarkerAnchorMode,
            effectiveNavMode,
            recenterTarget,
            mapView,
        ) {
            if (!offlineMode && effectiveNavMode != NavMode.PANNING) {
                recenterTarget?.let { mapView.setCenterForNavigationMarker(it, effectiveNavigationMarkerAnchorMode) }
            }
        }

        NavigateScreenDialogsHost(
            showKeepAppOpenInfoDialog = showKeepAppOpenInfoDialog,
            helpDialogMaxHeight = adaptive.helpDialogMaxHeight,
            onContinueKeepAppOpen = {
                showKeepAppOpenInfoDialog = false
                screenActions.continueKeepAppOpenEnableFlow()
            },
            onDismissKeepAppOpen = {
                showKeepAppOpenInfoDialog = false
                pendingKeepAppOpen = false
            },
            showNotificationPermissionDialog = showNotificationPermissionDialog,
            onContinueNotificationPermission = {
                showNotificationPermissionDialog = false
                notificationPermissionState.launchPermissionRequest()
            },
            onDismissNotificationPermission = {
                showNotificationPermissionDialog = false
                pendingKeepAppOpen = false
            },
        )

        val routeProgressRingSegments =
            remember(
                turnByTurnGuidanceSession?.trackId,
                turnByTurnGuidanceSession?.reversed,
                turnByTurnElevationProgressRingEnabled,
            ) {
                if (turnByTurnElevationProgressRingEnabled) {
                    turnByTurnGuidanceSession?.let(::buildRouteProgressRingSegments).orEmpty()
                } else {
                    emptyList()
                }
            }

        NavigateContent(
            mapFocusState = mapFocusState,
            mapFocusVisibleControls = mapFocusVisibleControls,
            onEnterMapFocus = ::enterMapFocus,
            onExitMapFocus = ::exitMapFocus,
            hasLocationPermission = locationPermissionState.hasLocationPermission || offlineMode,
            focusRequester = focusRequester,
            mapHolder = mapHolder,
            onMapViewReadyForRendering = { mapViewModel.onMapViewReadyForRendering() },
            onNavigateTimeSuppressedChange = onNavigateTimeSuppressedChange,
            showNavigateTime = showNavigateTime,
            navigateTimeFormat = navigateTimeFormat,
            mapAppearanceApplyInProgress = mapAppearanceApplyInProgress,
            hasActiveMap = !selectedMapPath.isNullOrBlank(),
            startupLocationWaitMessage = startupCentering.locationWaitMessage,
            slopeOverlayToggleEnabled = slopeOverlayToggleEnabled,
            slopeOverlayEnabled = slopeOverlayState.enabled,
            slopeOverlayProcessing = slopeOverlayState.processing,
            slopeOverlayProgressPercent = slopeOverlayState.progressPercent,
            zoomMin = zoomMin,
            zoomMax = zoomMax,
            zoomMinScaleMeters = zoomMinScaleMeters,
            zoomMaxScaleMeters = zoomMaxScaleMeters,
            crownZoomEnabled = crownZoomEnabled,
            mapPinchZoomEnabled = mapPinchZoomEnabled,
            crownZoomInverted = crownZoomInverted,
            mapZoomButtonsMode = mapZoomButtonsMode,
            northIndicatorMode = northIndicatorMode,
            currentZoomLevel = currentZoomLevel,
            onZoomLevelChange = { oldZoom, newZoom, inputSource ->
                navigateViewModel.onZoomChanged(newZoom)
                mapViewModel.recordCompletedZoomChange(
                    oldZoom = oldZoom,
                    newZoom = newZoom,
                    inputSource = inputSource,
                )
            },
            onMapPanCompleted = { mapViewModel.recordCompletedPan() },
            onViewportChanged = { center, zoomLevel ->
                mapZoomState.updateReference(center, mapView.width)
                if (offlineMode) {
                    mapViewModel.saveOfflineViewport(
                        selectedMapPath = selectedMapPath,
                        activeGpxDetails = activeGpxDetails,
                        center = center,
                        zoomLevel = zoomLevel,
                    )
                }
            },
            isMetric = isMetric,
            screenState = screenState,
            navMode = effectiveNavMode,
            locationMarker = locationMarker,
            lastKnownLocation = recenterTarget,
            onToggleOrientation = {
                if (!offlineMode) {
                    navigateViewModel.onToggleOrientation()
                }
            },
            onUserPanStarted = { navigateViewModel.onUserPanStarted() },
            onRecenter = { navigateViewModel.onRecenterRequested() },
            onRecenterRequested = {
                if (!offlineMode) {
                    locationViewModel.requestImmediateLocation(source = "ui_recenter_from_panning")
                }
            },
            autoRecenterEnabled = autoRecenterEnabled,
            autoRecenterDelay = autoRecenterDelay,
            onToggleAutoRecenter = { settingsViewModel.setAutoRecenterEnabled(!autoRecenterEnabled) },
            triggerHaptic = screenActions.triggerHaptic,
            onMenuClick = {
                val nowElapsedMs = SystemClock.elapsedRealtime()
                if (nowElapsedMs < menuClickGuardUntilElapsedMs) {
                    DebugTelemetry.log(
                        "NavigationTelemetry",
                        "event=menu_click_ignored route=navigate_screen reason=recent_wake " +
                            "ageMs=${nowElapsedMs - menuClickWakeElapsedMs} " +
                            "remainingMs=${menuClickGuardUntilElapsedMs - nowElapsedMs}",
                    )
                } else {
                    onMenuClick()
                }
            },
            onPermissionLaunch = { locationPermissionState.launchPermissions() },
            mapRotationDeg = renderedMapRotationDeg,
            navigationMarkerAnchorMode = effectiveNavigationMarkerAnchorMode,
            compassHeadingDeg = renderedCompassHeadingDeg,
            liveElevationEnabled = liveElevationEnabled,
            liveDistanceEnabled = liveDistanceEnabled && !offlineMode,
            keepAppOpen = keepAppOpen,
            onKeepAppOpenToggle = screenActions.toggleKeepAppOpen,
            backButtonExitsNavigation = backButtonExitsNavigation,
            traceRecordingViewModel = traceRecordingViewModel,
            traceRecordingState = traceRecordingState,
            recordingStatusMessage = recordingStatusMessage,
            recordingDashboardMetricSlots = recordingDashboardMetricSlots,
            turnByTurnDashboardMetricSlots = turnByTurnDashboardMetricSlots,
            userWeightKg = userWeightKg,
            backpackWeightKg = backpackWeightKg,
            bikeWeightKg = bikeWeightKg,
            recordingDashboardExpandRequestToken = recordingDashboardExpandRequestToken,
            recordingActionPromptRequestToken = recordingActionPromptRequestToken,
            onRecordingTimeTap = onRecordingTimeTap,
            onRecordingTimeLongPress = onRecordingTimeLongPress,
            onStartRecording = {
                shortcutTrayExpanded = false
                startRecordingWithActivityPermission()
            },
            onPauseRecording = traceRecordingViewModel::pauseRecording,
            onResumeRecording = traceRecordingViewModel::resumeRecording,
            onFinishRecording = traceRecordingViewModel::finishAndSaveRecording,
            onDiscardRecording = traceRecordingViewModel::discardRecording,
            onRecordingMetricSelected = settingsViewModel::setRecordingDashboardMetricSlot,
            onTurnByTurnMetricSelected = settingsViewModel::setTurnByTurnDashboardMetricSlot,
            shortcutTrayExpanded = shortcutTrayExpanded,
            onShortcutTrayToggle = screenActions.toggleShortcutTray,
            onShortcutTrayDismiss = { shortcutTrayExpanded = false },
            gpsIndicatorState = effectiveGpsIndicatorState,
            gpsEnvironmentWarning = gpsEnvironmentWarning,
            watchGpsDegradedWarning = watchGpsDegradedWarning,
            isOfflineMode = offlineMode,
            isGpxInspectionEnabled = isGpxInspectionEnabled,
            selectingGpxPointB = selectingGpxPointB,
            onCancelSelectingGpxPointB = { gpxViewModel.cancelSelectingB() },
            turnByTurnGuidanceState = guidanceRuntime.state,
            turnByTurnGuidancePaused = turnByTurnGuidancePaused,
            turnByTurnVoiceGuidanceEnabled = turnByTurnVoiceGuidanceEnabled,
            turnByTurnCompactPopupEnabled = turnByTurnCompactPopupEnabled,
            turnByTurnMapProgressEnabled = turnByTurnMapProgressEnabled,
            turnByTurnElevationProgressRingEnabled = turnByTurnElevationProgressRingEnabled,
            routeProgressRingSegments = routeProgressRingSegments,
            onTurnByTurnVoiceGuidanceChange = settingsViewModel::setTurnByTurnVoiceGuidanceEnabled,
            guideBackToRouteActive = guidanceRuntime.guideBackToRouteActive,
            showGuideBackPrompt = guidanceRuntime.showGuideBackPrompt,
            startDecisionPrompt = guidanceRuntime.startDecisionPrompt,
            onPauseTurnByTurnGuidance = { gpxViewModel.pauseTurnByTurnGuidance() },
            onResumeTurnByTurnGuidance = { gpxViewModel.resumeTurnByTurnGuidance() },
            onStopTurnByTurnGuidance = { gpxViewModel.stopTurnByTurnGuidance() },
            onGuideBackToRoute = guidanceRuntime.onGuideBackToRoute,
            onDismissGuideBackPrompt = guidanceRuntime.onDismissGuideBackPrompt,
            onAcceptStartDecisionPrompt = guidanceRuntime.onAcceptStartDecisionPrompt,
            onDismissStartDecisionPrompt = guidanceRuntime.onDismissStartDecisionPrompt,
            activeGpxDetails = activeGpxDetails,
            gpxTrackColor = gpxTrackColor,
            gpxTrackColorMode = gpxTrackColorMode,
            gpxTrackWidth = gpxTrackWidth,
            gpxTrackOpacityPercent = gpxTrackOpacityPercent,
            onMapLongPress = { latLong ->
                scope.launch {
                    if (isGpxInspectionEnabled) gpxViewModel.inspectMapLongPress(latLong)
                }
            },
            markerMotionDebugOverlayLabel = markerMotionDebugOverlayLabel,
            onCompassIssueNow =
                if (gpsDebugTelemetry && gpsDebugTelemetryPopupEnabled && !offlineMode) {
                    {
                        reportCompassIssueNow(
                            renderState = compassRenderState,
                            renderedHeadingDeg = renderedCompassHeadingDeg,
                            renderedMapRotationDeg = renderedMapRotationDeg,
                            screenState = screenState,
                        )
                    }
                } else {
                    null
                },
        )

        val missingMapPromptLocation =
            uiState.lastKnownLocation.takeIf { gpsSignalSnapshot.lastFixFresh && gpsFixFreshForAccuracyCircle }
        val canShowMissingMapPrompt =
            isScreenResumed &&
                screenState.isInteractive &&
                !offlineMode &&
                !traceRecordingState.active &&
                !traceRecordingState.saving &&
                turnByTurnGuidanceSession == null &&
                !showCalibrationDialog &&
                hillshadeTerrainUnavailableEvent == null &&
                !showKeepAppOpenInfoDialog &&
                !showNotificationPermissionDialog &&
                !shortcutTrayExpanded &&
                !selectingGpxPointB
        MissingMapPrompt(
            visible =
                shouldShowMissingMapPrompt(
                    location = missingMapPromptLocation,
                    installedBounds = installedMapBounds,
                    disabled = missingMapPromptDisabled,
                    dismissed = missingMapPromptDismissed,
                    canShow = canShowMissingMapPrompt,
                ),
            onDownload = {
                missingMapPromptLocation?.let { location ->
                    mapViewModel.dismissMissingMapPrompt()
                    onOpenMapBundles(location)
                }
            },
            onDismiss = { mapViewModel.dismissMissingMapPrompt() },
            onNeverShowAgain = { mapViewModel.dismissMissingMapPrompt(neverShowAgain = true) },
        )

        LaunchedEffect(isScreenResumed) {
            if (isScreenResumed) {
                focusRequester.requestFocus()
            }
        }

        DisposableEffect(mapView, offlineMode, selectedMapPath, activeGpxDetails) {
            onDispose {
                if (offlineMode) {
                    mapViewModel.saveOfflineViewport(
                        selectedMapPath = selectedMapPath,
                        activeGpxDetails = activeGpxDetails,
                        center = mapView.model.mapViewPosition.center,
                        zoomLevel =
                            mapView.model.mapViewPosition.zoomLevel
                                .toInt(),
                    )
                }
            }
        }
    }
}

private fun expectedMarkerGpsIntervalMs(
    runtimeReason: String,
    screenState: LocationScreenState,
    recordingSampleIntervalSeconds: Int,
    recordingScreenOffSampleIntervalSeconds: Int,
    turnByTurnGpsIntervalSeconds: Int,
    turnByTurnScreenOffGpsIntervalSeconds: Int,
): Long {
    val recordingScreenOnMs = gpsIntervalMsOrDefault(recordingSampleIntervalSeconds)
    val recordingScreenOffMs =
        screenOffGpsIntervalMs(
            screenOnIntervalMs = recordingScreenOnMs,
            screenOffSeconds = recordingScreenOffSampleIntervalSeconds,
        )
    val turnByTurnScreenOnMs = gpsIntervalMsOrDefault(turnByTurnGpsIntervalSeconds)
    val turnByTurnScreenOffMs =
        screenOffGpsIntervalMs(
            screenOnIntervalMs = turnByTurnScreenOnMs,
            screenOffSeconds = turnByTurnScreenOffGpsIntervalSeconds,
        )
    return when (runtimeReason) {
        NavigationRuntimeDemandReason.RECORDING ->
            if (screenState.isNonInteractive) recordingScreenOffMs else recordingScreenOnMs
        NavigationRuntimeDemandReason.RECORDING_AUTO_PAUSED ->
            maxOf(
                if (screenState.isNonInteractive) recordingScreenOffMs else recordingScreenOnMs,
                AUTO_PAUSE_GPS_INTERVAL_MS,
            )
        NavigationRuntimeDemandReason.RECORDING_GUIDANCE ->
            minOf(
                if (screenState.isNonInteractive) recordingScreenOffMs else recordingScreenOnMs,
                if (screenState.isNonInteractive) turnByTurnScreenOffMs else turnByTurnScreenOnMs,
            )
        NavigationRuntimeDemandReason.GUIDANCE_VISIBLE,
        NavigationRuntimeDemandReason.GUIDANCE_AMBIENT,
        NavigationRuntimeDemandReason.GUIDANCE_BACKGROUND,
        -> if (screenState.isNonInteractive) turnByTurnScreenOffMs else turnByTurnScreenOnMs
        else -> SettingsRepository.DEFAULT_GPS_INTERVAL_MS
    }
}

internal fun resolveMarkerGpsIntervalMs(
    serviceEffectiveIntervalMs: Long,
    configuredIntervalMs: Long,
): Long = serviceEffectiveIntervalMs.takeIf { it > 0L } ?: configuredIntervalMs

private fun screenOffGpsIntervalMs(
    screenOnIntervalMs: Long,
    screenOffSeconds: Int,
): Long =
    when (screenOffSeconds) {
        SettingsRepository.GPS_INTERVAL_ADAPTIVE_SCREEN_OFF_SECONDS ->
            SettingsRepository.DEFAULT_TURN_BY_TURN_GPS_INTERVAL_SECONDS * 1_000L
        SettingsRepository.GPS_INTERVAL_SAME_AS_SCREEN_ON_SECONDS -> screenOnIntervalMs
        SettingsRepository.RECORDING_SAMPLE_INTERVAL_DISABLED_SECONDS -> SettingsRepository.DEFAULT_GPS_INTERVAL_MS
        else -> gpsIntervalMsOrDefault(screenOffSeconds)
    }

private fun gpsIntervalMsOrDefault(seconds: Int): Long =
    when (seconds) {
        SettingsRepository.RECORDING_SAMPLE_INTERVAL_DISABLED_SECONDS -> SettingsRepository.DEFAULT_GPS_INTERVAL_MS
        else -> seconds.coerceAtLeast(1) * 1_000L
    }
