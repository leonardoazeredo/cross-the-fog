package codes.madera.crossfog.watch.presentation.features.navigate

import android.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalResources
import codes.madera.crossfog.watch.R
import codes.madera.crossfog.watch.core.service.diagnostics.ScreenOffActivityDiagnostics
import codes.madera.crossfog.watch.data.repository.SettingsRepository
import codes.madera.crossfog.watch.domain.sensors.CompassProviderType
import codes.madera.crossfog.watch.domain.sensors.CompassRenderState
import codes.madera.crossfog.watch.presentation.features.gpx.GpxInspectionUiState
import codes.madera.crossfog.watch.presentation.features.gpx.GpxTrackDetails
import codes.madera.crossfog.watch.presentation.features.gpx.InspectionABUiState
import codes.madera.crossfog.watch.presentation.features.gpx.InspectionAUiState
import codes.madera.crossfog.watch.presentation.features.maps.DisplayFrameLayerOwner
import codes.madera.crossfog.watch.presentation.features.maps.DisplayFrameMarker
import codes.madera.crossfog.watch.presentation.features.maps.GpxInspectionPopupA
import codes.madera.crossfog.watch.presentation.features.maps.GpxInspectionPopupAB
import codes.madera.crossfog.watch.presentation.features.maps.MapHolder
import codes.madera.crossfog.watch.presentation.features.maps.MapViewModel
import codes.madera.crossfog.watch.presentation.features.maps.RotatableMarker
import codes.madera.crossfog.watch.presentation.features.maps.mutateLayers
import codes.madera.crossfog.watch.presentation.features.recording.RecordingTraceHistoryLayer
import codes.madera.crossfog.watch.presentation.features.recording.RecordingTraceOverlayEffect
import codes.madera.crossfog.watch.presentation.features.recording.TraceRecordingUiState
import codes.madera.crossfog.watch.presentation.features.recording.recordingGapConnectors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.sample
import kotlinx.coroutines.withContext
import org.mapsforge.core.graphics.Style
import org.mapsforge.core.model.LatLong
import org.mapsforge.map.android.graphics.AndroidBitmap
import org.mapsforge.map.android.graphics.AndroidGraphicFactory
import org.mapsforge.map.android.view.MapView
import org.mapsforge.map.layer.overlay.Marker
import org.mapsforge.map.layer.overlay.Polyline
import org.mapsforge.map.model.common.Observer

private const val ELEVATION_TRACK_OUTLINE_ALPHA = 176
private const val ELEVATION_TRACK_OUTLINE_WIDTH_EXTRA_PX = 3f
private const val ROUTE_TOOL_PREVIEW_ALPHA = 228
private const val ROUTE_TOOL_CREATE_PREVIEW_ALPHA = 238
private const val ROUTE_TOOL_DRAFT_ALPHA = 170
private const val ROUTE_TOOL_PREVIEW_RED = 0
private const val ROUTE_TOOL_PREVIEW_GREEN = 217
private const val ROUTE_TOOL_PREVIEW_BLUE = 232

@Composable
@OptIn(FlowPreview::class)
@Suppress("FunctionNaming", "LongMethod", "LongParameterList")
internal fun MapOverlays(
    mapViewModel: MapViewModel,
    mapHolder: MapHolder,
    activeGpxDetails: List<GpxTrackDetails>,
    routeToolPreviewPoints: List<LatLong>,
    recordingTraceState: TraceRecordingUiState,
    recordingTraceFollowsMarker: Boolean,
    routeToolCreatePreviewActive: Boolean,
    routeToolDraftPoints: List<LatLong>,
    gpxTrackColor: Int,
    gpxTrackColorMode: String,
    gpxTrackWidth: Float,
    gpxTrackOpacityPercent: Int,
    gpxTrackDirectionArrowsEnabled: Boolean,
    compassRenderStateFlow: StateFlow<CompassRenderState>,
    compassInteractive: Boolean,
    navMode: NavMode,
    forceNorthUpInPanning: Boolean,
    showRealMarkerInCompassMode: Boolean,
    showCompassConeOverlay: Boolean,
    compassConeBaseSizePx: Int,
    compassQuality: CompassMarkerQuality,
    compassHeadingErrorDeg: Float?,
    gpsAccuracyCircleEnabled: Boolean,
    gpsFixAccuracyM: Float,
    gpsFixFresh: Boolean,
    gpsFixSpeedMps: Float,
    gpsFixBearingDeg: Float?,
    renderedHeadingDeg: Float,
    locationMarker: RotatableMarker?,
    navigationMarkerAnchorMode: String,
    inspectionUiState: GpxInspectionUiState?,
    selectedPointA: LatLong?,
    selectedPointB: LatLong?,
    onDismissInspection: () -> Unit,
    onStartSelectB: () -> Unit,
    isMetric: Boolean,
    onRenderedHeadingChanged: (Float) -> Unit,
    onRenderedMapRotationChanged: (Float) -> Unit,
) {
    val mapView = mapHolder.mapView
    var compassConeSuppressed by remember(mapView) {
        mutableStateOf(
            compassRenderStateFlow.value.providerType == CompassProviderType.GOOGLE_FUSED &&
                mapViewModel.navigateMagneticMotionFallback?.coneSuppressed == true,
        )
    }
    val gpsAccuracyCircleLayer =
        remember(mapView) {
            val fill =
                AndroidGraphicFactory.INSTANCE.createPaint().apply {
                    setStyle(Style.FILL)
                    color = Color.argb(54, 66, 153, 245)
                }
            val stroke =
                AndroidGraphicFactory.INSTANCE.createPaint().apply {
                    setStyle(Style.STROKE)
                    color = Color.argb(176, 21, 101, 192)
                    strokeWidth = 2f
                }
            GpsAccuracyCircleLayer(
                fillPaint = fill,
                strokePaint = stroke,
                displayFrameOwner = mapView as? DisplayFrameLayerOwner,
            )
        }
    val compassConeLayer =
        remember(mapView) {
            val frameOwner = mapView as? DisplayFrameLayerOwner
            findExistingCompassConeLayer(mapView) ?: CompassConeLayer(displayFrameOwner = frameOwner)
        }
    val markerAHolder = remember(mapView) { arrayOfNulls<Marker>(1) }
    val markerBHolder = remember(mapView) { arrayOfNulls<Marker>(1) }
    val topOverlayCoordinator =
        remember(
            mapView,
            gpsAccuracyCircleLayer,
            compassConeLayer,
            markerAHolder,
            markerBHolder,
        ) {
            MapTopOverlayCoordinator(
                layers = mapView.layerManager.layers,
                accuracyCircleLayer = gpsAccuracyCircleLayer,
                coneLayer = compassConeLayer,
                markerAHolder = markerAHolder,
                markerBHolder = markerBHolder,
            )
        }
    val redrawSignals =
        remember(mapView) {
            MutableSharedFlow<Unit>(
                extraBufferCapacity = 1,
                onBufferOverflow = BufferOverflow.DROP_OLDEST,
            )
        }
    val requestMapRedraw =
        remember(redrawSignals) {
            {
                ScreenOffActivityDiagnostics.recordMapRedrawRequest()
                redrawSignals.tryEmit(Unit)
                Unit
            }
        }

    LaunchedEffect(mapView, redrawSignals, navMode) {
        val frameBudgetMs =
            when (navMode) {
                NavMode.COMPASS_FOLLOW -> 40L
                NavMode.NORTH_UP_FOLLOW -> 40L
                NavMode.PANNING -> 50L
            }
        redrawSignals
            .sample(frameBudgetMs)
            .collect { mapView.requestLayerRedrawSafely() }
    }

    LaunchedEffect(locationMarker) {
        topOverlayCoordinator.updateLocationMarker(locationMarker)
    }

    NavigationOrientationEffect(
        mapViewModel = mapViewModel,
        isCompassMode = navMode == NavMode.COMPASS_FOLLOW,
        isAutoCentering = navMode != NavMode.PANNING,
        forceNorthUpInPanning = forceNorthUpInPanning,
        renderStateFlow = compassRenderStateFlow,
        compassInteractive = compassInteractive,
        mapView = mapView,
        showRealMarkerInCompassMode = showRealMarkerInCompassMode,
        locationMarker = locationMarker,
        navigationMarkerAnchorMode = navigationMarkerAnchorMode,
        onRenderedHeadingChanged = onRenderedHeadingChanged,
        onRenderedMapRotationChanged = onRenderedMapRotationChanged,
        onCompassConeSuppressedChanged = { compassConeSuppressed = it },
        requestMapRedraw = requestMapRedraw,
    )

    GpsAccuracyCircleLayerEffect(
        mapView = mapView,
        gpsAccuracyCircleEnabled = gpsAccuracyCircleEnabled,
        gpsFixAccuracyM = gpsFixAccuracyM,
        gpsFixFresh = gpsFixFresh,
        locationMarker = locationMarker,
        accuracyCircleLayer = gpsAccuracyCircleLayer,
        topOverlayCoordinator = topOverlayCoordinator,
        requestMapRedraw = requestMapRedraw,
    )

    CompassConeLayerEffect(
        mapView = mapView,
        compassInteractive = compassInteractive,
        navMode = navMode,
        showCompassConeOverlay = showCompassConeOverlay && !compassConeSuppressed,
        compassConeBaseSizePx = compassConeBaseSizePx,
        compassQuality = compassQuality,
        compassHeadingErrorDeg = compassHeadingErrorDeg,
        compassRenderStateFlow = compassRenderStateFlow,
        gpsFixAccuracyM = gpsFixAccuracyM,
        gpsFixFresh = gpsFixFresh,
        gpsFixSpeedMps = gpsFixSpeedMps,
        gpsFixBearingDeg = gpsFixBearingDeg,
        renderedHeadingDeg = renderedHeadingDeg,
        locationMarker = locationMarker,
        topOverlayCoordinator = topOverlayCoordinator,
        coneLayer = compassConeLayer,
        requestMapRedraw = requestMapRedraw,
    )

    GpxAndInspectionOverlayEffect(
        mapView = mapView,
        activeGpxDetails = activeGpxDetails,
        routeToolPreviewPoints = routeToolPreviewPoints,
        routeToolCreatePreviewActive = routeToolCreatePreviewActive,
        routeToolDraftPoints = routeToolDraftPoints,
        gpxTrackColor = gpxTrackColor,
        gpxTrackColorMode = gpxTrackColorMode,
        gpxTrackWidth = gpxTrackWidth,
        gpxTrackOpacityPercent = gpxTrackOpacityPercent,
        gpxTrackDirectionArrowsEnabled = gpxTrackDirectionArrowsEnabled,
        locationMarker = locationMarker,
        selectedPointA = selectedPointA,
        selectedPointB = selectedPointB,
        markerAHolder = markerAHolder,
        markerBHolder = markerBHolder,
        topOverlayCoordinator = topOverlayCoordinator,
        requestMapRedraw = requestMapRedraw,
    )

    RecordingTraceOverlayEffect(
        mapView = mapView,
        recordingState = recordingTraceState,
        followLocationMarker = recordingTraceFollowsMarker,
        locationMarker = locationMarker,
        topOverlayCoordinator = topOverlayCoordinator,
    )

    inspectionUiState?.let { ui ->
        when (ui) {
            is InspectionAUiState ->
                GpxInspectionPopupA(
                    state = ui,
                    onDismiss = onDismissInspection,
                    onSelectB = onStartSelectB,
                    isMetric = isMetric,
                )

            is InspectionABUiState ->
                GpxInspectionPopupAB(
                    state = ui,
                    onDismiss = onDismissInspection,
                    isMetric = isMetric,
                )
        }
    }
}

@Composable
@Suppress("FunctionNaming", "LongParameterList")
private fun GpsAccuracyCircleLayerEffect(
    mapView: MapView,
    gpsAccuracyCircleEnabled: Boolean,
    gpsFixAccuracyM: Float,
    gpsFixFresh: Boolean,
    locationMarker: RotatableMarker?,
    accuracyCircleLayer: GpsAccuracyCircleLayer,
    topOverlayCoordinator: MapTopOverlayCoordinator,
    requestMapRedraw: () -> Unit,
) {
    val clampedAccuracyMeters = sanitizeGpsAccuracyMeters(gpsFixAccuracyM)
    val shouldShow =
        gpsAccuracyCircleEnabled &&
            gpsFixFresh &&
            clampedAccuracyMeters != null &&
            locationMarker != null

    LaunchedEffect(
        mapView,
        gpsAccuracyCircleEnabled,
        gpsFixAccuracyM,
        gpsFixFresh,
        locationMarker,
    ) {
        mapView.mutateLayers { layers ->
            val hasLayer = layers.contains(accuracyCircleLayer)
            if (!hasLayer) {
                layers.add(accuracyCircleLayer)
            }
            accuracyCircleLayer.anchorMarker = locationMarker
            clampedAccuracyMeters?.let { safeRadius ->
                accuracyCircleLayer.radiusMeters = safeRadius
            }
            accuracyCircleLayer.isVisible = shouldShow
            val reordered = topOverlayCoordinator.sync(layers)
            if (!hasLayer || reordered) {
                requestMapRedraw()
            } else {
                mapView.requestLayerRedrawSafely()
            }
        }
    }

    DisposableEffect(mapView) {
        onDispose {
            mapView.mutateLayers { layers ->
                layers.remove(accuracyCircleLayer)
                mapView.requestLayerRedrawSafely()
            }
        }
    }
}

@Composable
@Suppress("FunctionNaming", "LongMethod", "LongParameterList")
private fun CompassConeLayerEffect(
    mapView: MapView,
    compassInteractive: Boolean,
    navMode: NavMode,
    showCompassConeOverlay: Boolean,
    compassConeBaseSizePx: Int,
    compassQuality: CompassMarkerQuality,
    compassHeadingErrorDeg: Float?,
    compassRenderStateFlow: StateFlow<CompassRenderState>,
    gpsFixAccuracyM: Float,
    gpsFixFresh: Boolean,
    gpsFixSpeedMps: Float,
    gpsFixBearingDeg: Float?,
    renderedHeadingDeg: Float,
    locationMarker: RotatableMarker?,
    topOverlayCoordinator: MapTopOverlayCoordinator,
    coneLayer: CompassConeLayer,
    requestMapRedraw: () -> Unit,
) {
    val coneTelemetryLogger = remember { ConeTelemetryLogger() }
    val shouldShow =
        showCompassConeOverlay &&
            locationMarker != null &&
            (navMode == NavMode.COMPASS_FOLLOW || navMode == NavMode.NORTH_UP_FOLLOW)
    val coneHeadingDeg =
        when (navMode) {
            NavMode.COMPASS_FOLLOW -> 0f
            NavMode.NORTH_UP_FOLLOW -> renderedHeadingDeg
            NavMode.PANNING -> 0f
        }

    if (shouldUpdateCompassConeLayer(compassInteractive)) {
        SideEffect {
            coneTelemetryLogger.log(
                ConeTelemetryDecision(
                    navMode = navMode,
                    overlayEnabled = showCompassConeOverlay,
                    shouldShow = shouldShow,
                    compass =
                        ConeTelemetryCompass(
                            quality = compassQuality,
                            headingErrorDeg = compassHeadingErrorDeg,
                            renderState = compassRenderStateFlow.value,
                            renderedHeadingDeg = renderedHeadingDeg,
                        ),
                    gps =
                        ConeTelemetryGps(
                            accuracyM = gpsFixAccuracyM,
                            fresh = gpsFixFresh,
                            speedMps = gpsFixSpeedMps,
                            bearingDeg = gpsFixBearingDeg,
                        ),
                    marker =
                        ConeTelemetryMarker(
                            present = locationMarker != null,
                            headingDeg = locationMarker?.heading,
                        ),
                ),
            )
        }
    }

    LaunchedEffect(
        mapView,
        compassInteractive,
        shouldShow,
        compassConeBaseSizePx,
        compassQuality,
        compassHeadingErrorDeg,
        coneHeadingDeg,
        locationMarker,
    ) {
        if (!shouldUpdateCompassConeLayer(compassInteractive)) return@LaunchedEffect
        mapView.mutateLayers { layers ->
            val hasLayer = layers.contains(coneLayer)
            if (!hasLayer) {
                layers.add(coneLayer)
            }
            coneLayer.anchorMarker = locationMarker
            coneLayer.baseMarkerSizePx = compassConeBaseSizePx
            coneLayer.quality = compassQuality
            coneLayer.headingErrorDeg = compassHeadingErrorDeg
            coneLayer.headingDeg = coneHeadingDeg
            coneLayer.isVisible = shouldShow
            topOverlayCoordinator.sync(layers)
            requestMapRedraw()
        }
    }

    DisposableEffect(mapView) {
        onDispose {
            mapView.mutateLayers {
                coneLayer.anchorMarker = null
                coneLayer.isVisible = false
                requestMapRedraw()
            }
        }
    }
}

private fun findExistingCompassConeLayer(mapView: MapView): CompassConeLayer? =
    mapView.layerManager.layers
        .firstOrNull { it is CompassConeLayer } as? CompassConeLayer

@Composable
@Suppress("CyclomaticComplexMethod", "FunctionNaming", "LongMethod", "LongParameterList")
private fun GpxAndInspectionOverlayEffect(
    mapView: MapView,
    activeGpxDetails: List<GpxTrackDetails>,
    routeToolPreviewPoints: List<LatLong>,
    routeToolCreatePreviewActive: Boolean,
    routeToolDraftPoints: List<LatLong>,
    gpxTrackColor: Int,
    gpxTrackColorMode: String,
    gpxTrackWidth: Float,
    gpxTrackOpacityPercent: Int,
    gpxTrackDirectionArrowsEnabled: Boolean,
    locationMarker: RotatableMarker?,
    selectedPointA: LatLong?,
    selectedPointB: LatLong?,
    markerAHolder: Array<Marker?>,
    markerBHolder: Array<Marker?>,
    topOverlayCoordinator: MapTopOverlayCoordinator,
    requestMapRedraw: () -> Unit,
) {
    val resources = LocalResources.current
    val useElevationTrackColors = gpxTrackColorMode == SettingsRepository.GPX_TRACK_COLOR_MODE_ELEVATION

    val trackPaint =
        remember {
            AndroidGraphicFactory.INSTANCE.createPaint().apply { setStyle(Style.STROKE) }
        }
    val gapPaint =
        remember {
            AndroidGraphicFactory.INSTANCE.createPaint().apply { setStyle(Style.STROKE) }
        }
    val previewPaint =
        remember {
            AndroidGraphicFactory.INSTANCE.createPaint().apply { setStyle(Style.STROKE) }
        }
    val draftPaint =
        remember {
            AndroidGraphicFactory.INSTANCE.createPaint().apply { setStyle(Style.STROKE) }
        }

    // Stable caches
    val polylinesById = remember(mapView) { mutableMapOf<String, List<Polyline>>() }
    val elevationPolylinesById = remember(mapView) { mutableMapOf<String, List<Polyline>>() }
    val gapLayersById = remember(mapView) { mutableMapOf<String, RecordingTraceHistoryLayer>() }
    val startMarkersById = remember(mapView) { mutableMapOf<String, Marker>() }
    val endMarkersById = remember(mapView) { mutableMapOf<String, Marker>() }
    val lodById = remember(mapView) { mutableMapOf<String, TrackLodLevels>() }
    val trackLodCacheById = remember(mapView) { mutableMapOf<String, TrackLodLevels>() }
    val displayedLodBucketById = remember(mapView) { mutableMapOf<String, Int>() }
    val previewPolyline =
        remember(mapView) {
            Polyline(previewPaint, AndroidGraphicFactory.INSTANCE)
        }
    val draftPolyline =
        remember(mapView) {
            Polyline(draftPaint, AndroidGraphicFactory.INSTANCE)
        }

    // Bitmaps
    val markerBitmapA =
        remember { AndroidBitmap(makeLabeledYellowDotBitmap(resources.getString(R.string.navigate_a), 28, 3, 235)) }
    val markerBitmapB =
        remember { AndroidBitmap(makeLabeledYellowDotBitmap(resources.getString(R.string.navigate_b), 28, 3, 190)) }
    val startBitmap =
        remember {
            AndroidBitmap(
                makeLabeledDotBitmap(
                    label = resources.getString(R.string.navigate_s),
                    sizePx = 20,
                    strokePx = 2,
                    fillColorArgb = android.graphics.Color.rgb(76, 175, 80),
                ),
            )
        }
    val endBitmap =
        remember {
            AndroidBitmap(
                makeLabeledDotBitmap(
                    label = resources.getString(R.string.navigate_e),
                    sizePx = 20,
                    strokePx = 2,
                    fillColorArgb = android.graphics.Color.rgb(244, 67, 54),
                ),
            )
        }
    val directionArrowLayer =
        remember(mapView) {
            GpxDirectionArrowLayer(AndroidBitmap(createGpxDirectionArrowBitmap()))
        }

    LaunchedEffect(gpxTrackColor, gpxTrackWidth, gpxTrackOpacityPercent, routeToolCreatePreviewActive) {
        trackPaint.color =
            applyOpacityToColor(
                color = gpxTrackColor,
                opacityPercent = gpxTrackOpacityPercent,
            )
        trackPaint.strokeWidth = gpxTrackWidth
        gapPaint.color = applyOpacityToColor(Color.rgb(128, 128, 128), gpxTrackOpacityPercent)
        gapPaint.strokeWidth = gpxTrackWidth
        previewPaint.color =
            if (routeToolCreatePreviewActive) {
                Color.argb(
                    ROUTE_TOOL_CREATE_PREVIEW_ALPHA,
                    ROUTE_TOOL_PREVIEW_RED,
                    ROUTE_TOOL_PREVIEW_GREEN,
                    ROUTE_TOOL_PREVIEW_BLUE,
                )
            } else {
                Color.argb(
                    ROUTE_TOOL_PREVIEW_ALPHA,
                    ROUTE_TOOL_PREVIEW_RED,
                    ROUTE_TOOL_PREVIEW_GREEN,
                    ROUTE_TOOL_PREVIEW_BLUE,
                )
            }
        previewPaint.strokeWidth = maxOf(gpxTrackWidth + 2f, 6f)
        draftPaint.color =
            Color.argb(
                ROUTE_TOOL_DRAFT_ALPHA,
                ROUTE_TOOL_PREVIEW_RED,
                ROUTE_TOOL_PREVIEW_GREEN,
                ROUTE_TOOL_PREVIEW_BLUE,
            )
        draftPaint.strokeWidth = maxOf(gpxTrackWidth, 4f)
        requestMapRedraw()
    }

    DisposableEffect(
        mapView,
        useElevationTrackColors,
        gpxTrackWidth,
        gpxTrackOpacityPercent,
        gpxTrackDirectionArrowsEnabled,
    ) {
        val observer =
            Observer {
                val zoomNow =
                    mapView.model.mapViewPosition.zoomLevel
                        .toInt()
                val newBucket = zoomBucketFor(zoomNow)
                mapView.mutateLayers(coalescingKey = directionArrowLayer) { layers ->
                    var changed = false

                    lodById.forEach { (id, lod) ->
                        val bucketChanged = displayedLodBucketById[id] != newBucket
                        if (!bucketChanged) {
                            return@forEach
                        }
                        val renderPoints = lod.pointsForZoom(zoomNow)

                        if (bucketChanged) {
                            if (useElevationTrackColors) {
                                elevationPolylinesById.remove(id)?.forEach { layers.remove(it) }
                                val segments =
                                    buildElevationTrackSegments(
                                        points = renderPoints,
                                        opacityPercent = gpxTrackOpacityPercent,
                                    )
                                elevationPolylinesById[id] =
                                    createElevationTrackPolylines(
                                        segments = segments,
                                        strokeWidth = gpxTrackWidth,
                                    ).also { polylines ->
                                        polylines.forEach(layers::add)
                                    }
                                changed = true
                            } else {
                                val syncResult =
                                    syncSolidTrackPolylines(
                                        layers = layers,
                                        current = polylinesById[id].orEmpty(),
                                        segments = renderPoints.latLongSegments(),
                                        paint = trackPaint,
                                    )
                                polylinesById[id] = syncResult.polylines
                                changed = syncResult.changed || changed
                            }
                            displayedLodBucketById[id] = newBucket
                        }
                    }

                    if (changed && layers.contains(directionArrowLayer)) {
                        layers.remove(directionArrowLayer)
                        layers.add(directionArrowLayer)
                    }

                    val reordered = if (changed) topOverlayCoordinator.sync(layers) else false
                    if (changed || reordered) requestMapRedraw()
                }
            }

        mapView.model.mapViewPosition.addObserver(observer)
        onDispose { mapView.model.mapViewPosition.removeObserver(observer) }
    }

    // Update polylines + S/E markers
    LaunchedEffect(
        activeGpxDetails,
        useElevationTrackColors,
        gpxTrackWidth,
        gpxTrackOpacityPercent,
        gpxTrackDirectionArrowsEnabled,
    ) {
        val wantedIds = activeGpxDetails.map { it.id }.toSet()
        val cachedLodsById = trackLodCacheById.toMap()
        val computedLodById =
            withContext(Dispatchers.Default) {
                activeGpxDetails.associate { details ->
                    details.id to
                        getOrBuildTrackLodLevels(
                            trackId = details.id,
                            points = details.trackPoints,
                            cachedById = cachedLodsById,
                        )
                }
            }

        val gapsById =
            withContext(Dispatchers.Default) {
                activeGpxDetails.associate { details ->
                    details.id to
                        if (details.isActivity) {
                            recordingGapConnectors(details.trackPoints.allLatLongSegments())
                        } else {
                            emptyList()
                        }
                }
            }

        // Layer mutations can wait for gesture idle, so publish reusable geometry first.
        trackLodCacheById.clear()
        trackLodCacheById.putAll(computedLodById)

        mapView.mutateLayers { layers ->
            var changed = false
            // remove old layers
            val staleOverlayIds =
                trackedGpxOverlayIds(
                    polylinesById = polylinesById,
                    elevationPolylinesById = elevationPolylinesById,
                    startMarkersById = startMarkersById,
                    endMarkersById = endMarkersById,
                    lodById = lodById,
                    displayedLodBucketById = displayedLodBucketById,
                ) - wantedIds
            staleOverlayIds.forEach { id ->
                gapLayersById.remove(id)?.let { changed = layers.remove(it) || changed }
                polylinesById.remove(id)?.forEach { polyline ->
                    changed = layers.remove(polyline) || changed
                }
                elevationPolylinesById.remove(id)?.forEach { polyline ->
                    layers.remove(polyline)
                    changed = true
                }
                if (startMarkersById.remove(id)?.let {
                        layers.remove(it)
                        true
                    } == true
                ) {
                    changed = true
                }
                if (endMarkersById.remove(id)?.let {
                        layers.remove(it)
                        true
                    } == true
                ) {
                    changed = true
                }
                lodById.remove(id)
                displayedLodBucketById.remove(id)
            }

            val arrowsVisible = gpxTrackDirectionArrowsEnabled && computedLodById.isNotEmpty()
            directionArrowLayer.trackLods = if (arrowsVisible) computedLodById else emptyMap()
            directionArrowLayer.isVisible = arrowsVisible
            val arrowLayerAttached = layers.contains(directionArrowLayer)
            if (arrowsVisible && !arrowLayerAttached) {
                layers.add(directionArrowLayer)
                changed = true
            } else if (!arrowsVisible && arrowLayerAttached) {
                layers.remove(directionArrowLayer)
                changed = true
            }

            // add/update polylines and S/E markers
            val zoomNow =
                mapView.model.mapViewPosition.zoomLevel
                    .toInt()
            val currentBucket = zoomBucketFor(zoomNow)
            activeGpxDetails.forEach { details ->
                val lod = computedLodById[details.id] ?: return@forEach
                lodById[details.id] = lod
                val gaps = gapsById[details.id].orEmpty()
                if (gaps.isEmpty()) {
                    gapLayersById.remove(details.id)?.let { changed = layers.remove(it) || changed }
                } else {
                    val gapLayer = gapLayersById.getOrPut(details.id) { RecordingTraceHistoryLayer(gapPaint) }
                    gapLayer.segments = gaps
                    if (!layers.contains(gapLayer)) layers.add(gapLayer)
                    changed = true
                }
                val renderPoints = lod.pointsForZoom(zoomNow)

                if (useElevationTrackColors) {
                    polylinesById.remove(details.id)?.forEach { solidPolyline ->
                        changed = layers.remove(solidPolyline) || changed
                    }
                    elevationPolylinesById.remove(details.id)?.forEach { polyline ->
                        layers.remove(polyline)
                        changed = true
                    }
                    val segments =
                        buildElevationTrackSegments(
                            points = renderPoints,
                            opacityPercent = gpxTrackOpacityPercent,
                        )
                    elevationPolylinesById[details.id] =
                        createElevationTrackPolylines(
                            segments = segments,
                            strokeWidth = gpxTrackWidth,
                        ).also { polylines ->
                            polylines.forEach(layers::add)
                            if (polylines.isNotEmpty()) {
                                changed = true
                            }
                        }
                } else {
                    elevationPolylinesById.remove(details.id)?.forEach { polyline ->
                        layers.remove(polyline)
                        changed = true
                    }
                    val syncResult =
                        syncSolidTrackPolylines(
                            layers = layers,
                            current = polylinesById[details.id].orEmpty(),
                            segments = renderPoints.latLongSegments(),
                            paint = trackPaint,
                        )
                    polylinesById[details.id] = syncResult.polylines
                    changed = syncResult.changed || changed
                }
                displayedLodBucketById[details.id] = currentBucket

                // Start marker
                details.startPoint?.let { start ->
                    val existing = startMarkersById[details.id]
                    if (existing == null) {
                        val m = Marker(start, startBitmap, 0, 0)
                        startMarkersById[details.id] = m
                        layers.add(m)
                        changed = true
                    } else {
                        if (setMarkerLatLongIfChanged(existing, start)) changed = true
                    }
                }

                // End marker
                details.endPoint?.let { end ->
                    val existing = endMarkersById[details.id]
                    if (existing == null) {
                        val m = Marker(end, endBitmap, 0, 0)
                        endMarkersById[details.id] = m
                        layers.add(m)
                        changed = true
                    } else {
                        if (setMarkerLatLongIfChanged(existing, end)) changed = true
                    }
                }
            }

            val reordered = topOverlayCoordinator.sync(layers)

            if (changed || reordered) requestMapRedraw()
        }
    }

    LaunchedEffect(routeToolPreviewPoints) {
        mapView.mutateLayers { layers ->
            var changed = false
            val hasPreview = routeToolPreviewPoints.size >= 2
            val previewAttached = layers.contains(previewPolyline)

            if (hasPreview) {
                if (!previewAttached) {
                    layers.add(previewPolyline)
                    changed = true
                }
                if (!hasSameLatLongs(previewPolyline.latLongs, routeToolPreviewPoints)) {
                    previewPolyline.latLongs.clear()
                    previewPolyline.latLongs.addAll(routeToolPreviewPoints)
                    changed = true
                }
            } else if (previewAttached) {
                layers.remove(previewPolyline)
                previewPolyline.latLongs.clear()
                changed = true
            }

            val reordered = topOverlayCoordinator.sync(layers)
            if (changed || reordered) requestMapRedraw()
        }
    }

    LaunchedEffect(routeToolDraftPoints) {
        mapView.mutateLayers { layers ->
            var changed = false
            val hasDraft = routeToolDraftPoints.size >= 2
            val draftAttached = layers.contains(draftPolyline)

            if (hasDraft) {
                if (!draftAttached) {
                    layers.add(draftPolyline)
                    changed = true
                }
                if (!hasSameLatLongs(draftPolyline.latLongs, routeToolDraftPoints)) {
                    draftPolyline.latLongs.clear()
                    draftPolyline.latLongs.addAll(routeToolDraftPoints)
                    changed = true
                }
            } else if (draftAttached) {
                layers.remove(draftPolyline)
                draftPolyline.latLongs.clear()
                changed = true
            }

            val reordered = topOverlayCoordinator.sync(layers)
            if (changed || reordered) requestMapRedraw()
        }
    }

    // Re-apply desired z-order when top overlays change.
    LaunchedEffect(locationMarker, selectedPointA, selectedPointB) {
        mapView.mutateLayers { layers ->
            val changed = topOverlayCoordinator.sync(layers)
            if (changed) requestMapRedraw()
        }
    }

    // ✅ Marker A (NO re-snap: GpxViewModel already provides a point ON the track)
    LaunchedEffect(selectedPointA, activeGpxDetails) {
        mapView.mutateLayers { layers ->
            var changed = false
            markerAHolder[0]?.let {
                layers.remove(it)
                changed = true
            }
            markerAHolder[0] =
                selectedPointA?.let { ll ->
                    val snapped = snapToRenderedTrackOrNull(ll, activeGpxDetails) ?: ll
                    DisplayFrameMarker(snapped, markerBitmapA, displayFrameOwner = mapView as? DisplayFrameLayerOwner)
                        .also {
                            layers.add(it)
                            changed = true
                        }
                }
            val reordered = topOverlayCoordinator.sync(layers)
            if (changed || reordered) requestMapRedraw()
        }
    }

    // ✅ Marker B (NO re-snap: GpxViewModel already provides a point ON the track)
    LaunchedEffect(selectedPointB, activeGpxDetails) {
        mapView.mutateLayers { layers ->
            var changed = false
            markerBHolder[0]?.let {
                layers.remove(it)
                changed = true
            }
            markerBHolder[0] =
                selectedPointB?.let { ll ->
                    val snapped = snapToRenderedTrackOrNull(ll, activeGpxDetails) ?: ll
                    DisplayFrameMarker(snapped, markerBitmapB, displayFrameOwner = mapView as? DisplayFrameLayerOwner)
                        .also {
                            layers.add(it)
                            changed = true
                        }
                }
            val reordered = topOverlayCoordinator.sync(layers)
            if (changed || reordered) requestMapRedraw()
        }
    }

    DisposableEffect(mapView) {
        onDispose {
            mapView.mutateLayers { layers ->
                polylinesById.values.flatten().forEach(layers::remove)
                elevationPolylinesById.values.flatten().forEach(layers::remove)
                gapLayersById.values.forEach(layers::remove)
                startMarkersById.values.forEach(layers::remove)
                endMarkersById.values.forEach(layers::remove)
                layers.remove(directionArrowLayer)
                markerAHolder[0]?.let(layers::remove)
                markerBHolder[0]?.let(layers::remove)
                layers.remove(previewPolyline)

                polylinesById.clear()
                elevationPolylinesById.clear()
                gapLayersById.clear()
                startMarkersById.clear()
                endMarkersById.clear()
                directionArrowLayer.trackLods = emptyMap()
                lodById.clear()
                trackLodCacheById.clear()
                displayedLodBucketById.clear()
                previewPolyline.latLongs.clear()
                markerAHolder[0] = null
                markerBHolder[0] = null

                mapView.requestLayerRedrawSafely()
            }
        }
    }
}

@Suppress("LongParameterList")
private fun trackedGpxOverlayIds(
    polylinesById: Map<String, List<Polyline>>,
    elevationPolylinesById: Map<String, List<Polyline>>,
    startMarkersById: Map<String, Marker>,
    endMarkersById: Map<String, Marker>,
    lodById: Map<String, TrackLodLevels>,
    displayedLodBucketById: Map<String, Int>,
): Set<String> =
    buildSet {
        addAll(polylinesById.keys)
        addAll(elevationPolylinesById.keys)
        addAll(startMarkersById.keys)
        addAll(endMarkersById.keys)
        addAll(lodById.keys)
        addAll(displayedLodBucketById.keys)
    }

private fun createElevationTrackPolylines(
    segments: List<ElevationTrackSegment>,
    strokeWidth: Float,
): List<Polyline> {
    val outlineWidth = strokeWidth + ELEVATION_TRACK_OUTLINE_WIDTH_EXTRA_PX
    val outlineColor = Color.argb(ELEVATION_TRACK_OUTLINE_ALPHA, 18, 24, 32)
    val outlines =
        segments.map { segment ->
            createElevationTrackPolyline(
                points = segment.points,
                color = outlineColor,
                strokeWidth = outlineWidth,
            )
        }
    val coloredSegments =
        segments.map { segment ->
            createElevationTrackPolyline(
                points = segment.points,
                color = segment.color,
                strokeWidth = strokeWidth,
            )
        }
    return outlines + coloredSegments
}

private fun createElevationTrackPolyline(
    points: List<LatLong>,
    color: Int,
    strokeWidth: Float,
): Polyline =
    Polyline(
        createGpxTrackPaint(
            color = color,
            strokeWidth = strokeWidth,
        ),
        AndroidGraphicFactory.INSTANCE,
    ).also { polyline ->
        polyline.latLongs.addAll(points)
    }
