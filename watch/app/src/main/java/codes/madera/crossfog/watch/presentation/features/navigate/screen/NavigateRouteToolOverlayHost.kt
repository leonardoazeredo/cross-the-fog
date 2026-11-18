package codes.madera.crossfog.watch.presentation.features.navigate

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import codes.madera.crossfog.watch.R
import codes.madera.crossfog.watch.presentation.features.gpx.GpxTrackDetails
import codes.madera.crossfog.watch.presentation.features.routetools.RouteCreateMode
import codes.madera.crossfog.watch.presentation.features.routetools.RouteCrosshairOverlay
import codes.madera.crossfog.watch.presentation.features.routetools.RouteMultiPointMapProjection
import codes.madera.crossfog.watch.presentation.features.routetools.RouteMultiPointOverlayState
import codes.madera.crossfog.watch.presentation.features.routetools.RouteMultiPointPointsOverlay
import codes.madera.crossfog.watch.presentation.features.routetools.RouteReshapeHandlesOverlay
import codes.madera.crossfog.watch.presentation.features.routetools.RouteReshapePreviewOverlay
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolCreatePreview
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolKind
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolOptions
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolSession
import codes.madera.crossfog.watch.presentation.ui.WearScreenSize
import org.mapsforge.core.model.LatLong
import org.mapsforge.map.android.view.MapView

@Composable
@Suppress("LongParameterList")
internal fun BoxScope.NavigateRouteToolOverlayHost(
    routeToolSession: RouteToolSession?,
    activeGpxDetails: List<GpxTrackDetails>,
    mapView: MapView,
    mapRotationDeg: Float,
    viewportRevision: Int,
    screenSize: WearScreenSize,
    isMetric: Boolean,
    routeToolCreatePreview: RouteToolCreatePreview?,
    routeToolCreatePreviewInProgress: Boolean,
    routeToolCreatePreviewMessage: String?,
    routeToolDraftConnectorPoints: List<LatLong>,
    gpxTrackColor: Int,
    onRouteToolPickHere: (LatLong) -> Unit,
    onRouteToolUndoLastPoint: () -> Unit,
    onRouteToolSaveCreatePreview: () -> Unit,
    onRouteToolRefreshCreatePreview: () -> Unit,
    onCancelRouteToolMode: () -> Unit,
    reshapePreviewInspectMode: Boolean,
    reshapePreviewPoints: List<LatLong>,
    reshapePreviewTitle: String,
    reshapePreviewInstruction: String,
    reshapePreviewBusy: Boolean,
    reshapePreviewBusyMessage: String?,
    reshapePreviewMessage: String?,
    onDismissReshapePreview: () -> Unit,
    onSaveReshapePreview: () -> Unit,
    crosshairSelectionActive: Boolean,
    crosshairSelectionBusy: Boolean,
    crosshairSelectionBusyMessage: String?,
    crosshairSelectionTitle: String?,
    crosshairSelectionInstruction: String?,
    onCrosshairSelectionPickHere: ((LatLong) -> Unit)?,
    onCancelCrosshairSelection: (() -> Unit)?,
    visibleMapSizePx: IntSize,
) {
    if (routeToolSession != null) {
        val session = routeToolSession
        val activeRouteToolTrack = activeGpxDetails.singleOrNull()
        RouteReshapeHandlesOverlay(
            session = session,
            activeTrack = activeRouteToolTrack,
            mapView = mapView,
            mapRotationDeg = mapRotationDeg,
            viewportRevision = viewportRevision,
        )
        RouteCrosshairOverlay(
            session = session,
            screenSize = screenSize,
            isMetric = isMetric,
            createPreview = routeToolCreatePreview,
            createPreviewInProgress = routeToolCreatePreviewInProgress,
            createPreviewMessage = routeToolCreatePreviewMessage,
            onPickHere = {
                onRouteToolPickHere(
                    resolveVisibleScreenCenterLatLong(
                        mapView = mapView,
                        visibleHeightPx = visibleMapSizePx.height,
                    ) ?: mapView.model.mapViewPosition.center,
                )
            },
            onCancel = onCancelRouteToolMode,
            onUndoLastPoint = onRouteToolUndoLastPoint,
            onSaveCreatePreview = onRouteToolSaveCreatePreview,
            onRefreshCreatePreview = onRouteToolRefreshCreatePreview,
        )
        RouteMultiPointPointsOverlay(
            overlayState =
                RouteMultiPointOverlayState(
                    session = session,
                    draftConnectorPoints = routeToolDraftConnectorPoints,
                    gpxTrackColor = gpxTrackColor,
                ),
            mapProjection =
                RouteMultiPointMapProjection(
                    mapView = mapView,
                    mapRotationDeg = mapRotationDeg,
                    viewportRevision = viewportRevision,
                ),
        )
    } else if (reshapePreviewInspectMode && reshapePreviewPoints.size >= 2) {
        RouteReshapePreviewOverlay(
            screenSize = screenSize,
            title = reshapePreviewTitle,
            instruction = reshapePreviewInstruction,
            busy = reshapePreviewBusy,
            busyMessage = reshapePreviewBusyMessage,
            message = reshapePreviewMessage,
            onDismiss = onDismissReshapePreview,
            onSave = onSaveReshapePreview,
        )
    } else if (
        crosshairSelectionActive &&
        onCrosshairSelectionPickHere != null &&
        onCancelCrosshairSelection != null
    ) {
        val poiSelectionSession =
            remember {
                RouteToolSession(
                    options =
                        RouteToolOptions(
                            toolKind = RouteToolKind.CREATE,
                            createMode = RouteCreateMode.CURRENT_TO_HERE,
                        ),
                )
            }
        RouteCrosshairOverlay(
            session = poiSelectionSession,
            screenSize = screenSize,
            isMetric = isMetric,
            busy = crosshairSelectionBusy,
            busyMessage = crosshairSelectionBusyMessage,
            titleOverride = crosshairSelectionTitle ?: stringResource(R.string.navigate_poi),
            instructionOverride =
                crosshairSelectionInstruction ?: stringResource(
                    R.string.navigate_move_map_then_check,
                ),
            popupTopOffset = 4.dp,
            showCapturedPoints = false,
            onPickHere = {
                onCrosshairSelectionPickHere(
                    resolveVisibleScreenCenterLatLong(
                        mapView = mapView,
                        visibleHeightPx = visibleMapSizePx.height,
                    ) ?: mapView.model.mapViewPosition.center,
                )
            },
            onCancel = onCancelCrosshairSelection,
        )
    }
}
