package codes.madera.crossfog.watch.presentation.features.navigate

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import codes.madera.crossfog.watch.R
import codes.madera.crossfog.watch.presentation.features.gpx.GpxViewModel
import codes.madera.crossfog.watch.presentation.features.routetools.CoordinateStep
import codes.madera.crossfog.watch.presentation.features.routetools.CoordinateStepSelector
import codes.madera.crossfog.watch.presentation.features.routetools.CoordinateTextEntryDialog
import codes.madera.crossfog.watch.presentation.features.routetools.CoordinateValueEditorRow
import codes.madera.crossfog.watch.presentation.features.routetools.RouteCreateMode
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolDraftSummaryDialog
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolKind
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolLoopRetryOption
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolOptions
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolProgressDialog
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolResultDialog
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolSaveResult
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolSession
import codes.madera.crossfog.watch.presentation.features.routetools.RouteToolsActionPanel
import codes.madera.crossfog.watch.presentation.features.routetools.formatCoordinateValue
import codes.madera.crossfog.watch.presentation.features.routetools.isValidRouteToolCoordinate
import codes.madera.crossfog.watch.presentation.features.routetools.normalizeLongitude
import codes.madera.crossfog.watch.presentation.features.routetools.withVisibleLoopDefaults
import codes.madera.crossfog.watch.presentation.ui.RenameValueDialog
import codes.madera.crossfog.watch.presentation.ui.WearActionButtonRole
import codes.madera.crossfog.watch.presentation.ui.WearActionDialog
import codes.madera.crossfog.watch.presentation.ui.WearActionDialogButton
import codes.madera.crossfog.watch.presentation.ui.WearFormDialog
import org.mapsforge.core.model.LatLong

@Composable
@Suppress("LongParameterList", "FunctionNaming", "LongMethod", "CyclomaticComplexMethod")
internal fun NavigateScreenDialogsHost(
    showKeepAppOpenInfoDialog: Boolean,
    helpDialogMaxHeight: Dp,
    onContinueKeepAppOpen: () -> Unit,
    onDismissKeepAppOpen: () -> Unit,
    showNotificationPermissionDialog: Boolean,
    onContinueNotificationPermission: () -> Unit,
    onDismissNotificationPermission: () -> Unit,
    mapLongPressTarget: LatLong?,
    onCreateRouteAtMapLongPress: (LatLong) -> Unit,
    onDismissMapLongPressActions: () -> Unit,
    showRouteToolsPanel: Boolean,
    activeGpxDetailsCount: Int,
    coordinateSeed: LatLong?,
    routeToolOptions: RouteToolOptions,
    routeToolPreflightMessage: String?,
    onRouteToolOptionsChange: (RouteToolOptions) -> Unit,
    routeToolActions: NavigateRouteToolActions,
    completedRouteToolDraft: RouteToolSession?,
    reshapePreviewInspectMode: Boolean,
    routeToolExecutionInProgress: Boolean,
    routeToolExecutionMessage: String?,
    routeToolExecutionStatus: String?,
    routeToolLoopRetryOptions: List<RouteToolLoopRetryOption>,
    onDismissDraftSummary: () -> Unit,
    onSetRouteToolOptions: (RouteToolOptions) -> Unit,
    onClearRouteToolExecutionMessage: () -> Unit,
    onClearRouteToolLoopRetryOptions: () -> Unit,
    routeToolResult: RouteToolSaveResult?,
    routeToolRenameInProgress: Boolean,
    routeToolRenameError: String?,
    isMetric: Boolean,
    recordingGpsEnabled: Boolean,
    gpxViewModel: GpxViewModel,
    onSetRouteToolResult: (RouteToolSaveResult?) -> Unit,
    onSetRouteToolRenameInProgress: (Boolean) -> Unit,
    onSetRouteToolRenameError: (String?) -> Unit,
    onDismissRouteToolsPanel: () -> Unit,
    onOpenGpxToolsSettings: () -> Unit,
    onRouteToolGuidanceStarted: () -> Unit,
) {
    val resources = LocalResources.current
    var showGpsDeactivatedInfo by rememberSaveable { mutableStateOf(false) }

    NavigateKeepAppOpenDialog(
        visible = showKeepAppOpenInfoDialog,
        helpDialogMaxHeight = helpDialogMaxHeight,
        onContinue = onContinueKeepAppOpen,
        onDismiss = onDismissKeepAppOpen,
    )

    NavigateNotificationPermissionDialog(
        visible = showNotificationPermissionDialog,
        onContinue = onContinueNotificationPermission,
        onDismiss = onDismissNotificationPermission,
    )

    MapLongPressActionDialog(
        target = mapLongPressTarget,
        onCreateRoute = onCreateRouteAtMapLongPress,
        onDismiss = onDismissMapLongPressActions,
    )

    NavigateRouteToolDialogs(
        showRouteToolsPanel = showRouteToolsPanel,
        canModifyActiveGpx = activeGpxDetailsCount == 1,
        coordinateSeed = coordinateSeed,
        options = routeToolOptions,
        preflightMessage = routeToolPreflightMessage,
        onOptionsChange = onRouteToolOptionsChange,
        onDismissRouteToolsPanel = onDismissRouteToolsPanel,
        onOpenGpxToolsSettings = onOpenGpxToolsSettings,
        onStartRouteToolSelection = routeToolActions.startRouteToolSelection,
        completedRouteToolDraft = if (reshapePreviewInspectMode) null else completedRouteToolDraft,
        routeToolExecutionInProgress = routeToolExecutionInProgress,
        routeToolExecutionMessage = routeToolExecutionMessage,
        routeToolLoopRetryOptions = routeToolLoopRetryOptions,
        onDismissDraftSummary = onDismissDraftSummary,
        onConfirmCreateDraft =
            completedRouteToolDraft
                ?.takeIf { it.options.toolKind == RouteToolKind.CREATE }
                ?.let { draft ->
                    {
                        onClearRouteToolLoopRetryOptions()
                        if (draft.options.createMode == RouteCreateMode.LOOP_AROUND_HERE) {
                            routeToolActions.startRouteToolSelection(draft)
                        } else {
                            routeToolActions.executeCreateDraft(draft, false)
                        }
                    }
                },
        onConfirmModifyDraft =
            completedRouteToolDraft
                ?.takeIf { it.options.toolKind == RouteToolKind.MODIFY }
                ?.let { draft ->
                    {
                        routeToolActions.executeModifyDraft(draft, false)
                    }
                },
        onSelectLoopRetryOption = { retryOption ->
            val draft = completedRouteToolDraft ?: return@NavigateRouteToolDialogs
            onClearRouteToolExecutionMessage()
            onClearRouteToolLoopRetryOptions()
            onSetRouteToolOptions(retryOption.options.withVisibleLoopDefaults())
            routeToolActions.startRouteToolSelection(
                draft.copy(
                    options = retryOption.options,
                    loopVariationIndex = 0,
                ),
            )
        },
        routeToolProgressVisible =
            routeToolExecutionInProgress &&
                completedRouteToolDraft == null &&
                routeToolExecutionStatus != null,
        routeToolProgressMessage = routeToolExecutionStatus ?: stringResource(R.string.navigate_working),
        routeToolResult = routeToolResult,
        isMetric = isMetric,
        routeToolRenameInProgress = routeToolRenameInProgress,
        routeToolRenameError = routeToolRenameError,
        onDismissRouteToolResult = {
            if (!routeToolRenameInProgress) {
                onSetRouteToolResult(null)
                onSetRouteToolRenameError(null)
            }
        },
        onDeleteRouteToolResult = {
            val currentResult = routeToolResult ?: return@NavigateRouteToolDialogs
            if (routeToolRenameInProgress) return@NavigateRouteToolDialogs
            gpxViewModel.deleteGpxFile(currentResult.filePath)
            onSetRouteToolResult(null)
            onSetRouteToolRenameError(null)
        },
        onOpenRouteToolRename = {
            onSetRouteToolRenameError(null)
        },
        onConfirmRouteToolRename = { newName ->
            val currentResult = routeToolResult ?: return@NavigateRouteToolDialogs
            if (routeToolRenameInProgress) return@NavigateRouteToolDialogs
            onSetRouteToolRenameInProgress(true)
            onSetRouteToolRenameError(null)
            gpxViewModel.renameRouteToolResult(
                filePath = currentResult.filePath,
                newName = newName,
            ) { result ->
                onSetRouteToolRenameInProgress(false)
                result
                    .onSuccess { updatedResult ->
                        onSetRouteToolRenameError(null)
                        onSetRouteToolResult(updatedResult)
                    }.onFailure { error ->
                        onSetRouteToolRenameError(
                            error.localizedMessage?.takeIf { it.isNotBlank() }
                                ?: resources.getString(R.string.gpx_failed_to_rename_the_gpx),
                        )
                    }
            }
        },
        onStartRouteToolGuidance = {
            val currentResult = routeToolResult ?: return@NavigateRouteToolDialogs
            if (routeToolRenameInProgress) return@NavigateRouteToolDialogs
            if (!recordingGpsEnabled) {
                showGpsDeactivatedInfo = true
                return@NavigateRouteToolDialogs
            }
            onSetRouteToolRenameError(null)
            gpxViewModel.startTurnByTurnGuidance(currentResult.filePath) { result ->
                result
                    .onSuccess {
                        onSetRouteToolResult(null)
                        onSetRouteToolRenameError(null)
                        onRouteToolGuidanceStarted()
                    }.onFailure { error ->
                        onSetRouteToolRenameError(
                            error.localizedMessage?.takeIf { it.isNotBlank() }
                                ?: resources.getString(R.string.navigate_failed_to_start_guidance),
                        )
                    }
            }
        },
    )

    WearActionDialog(
        visible = showGpsDeactivatedInfo,
        title = stringResource(R.string.navigation_gps_deactivated),
        message = stringResource(R.string.navigate_activate_gps_in_recording_settings_before_starting_guidance),
        confirmText = stringResource(R.string.common_ok),
        onConfirm = { showGpsDeactivatedInfo = false },
        onDismissRequest = { showGpsDeactivatedInfo = false },
    )
}

@Composable
@Suppress("FunctionNaming")
private fun MapLongPressActionDialog(
    target: LatLong?,
    onCreateRoute: (LatLong) -> Unit,
    onDismiss: () -> Unit,
) {
    val point = target ?: return
    WearActionDialog(
        visible = true,
        title = stringResource(R.string.navigate_map_point),
        onDismissRequest = onDismiss,
        buttons =
            listOf(
                WearActionDialogButton(
                    text = stringResource(R.string.navigate_create_route),
                    onClick = { onCreateRoute(point) },
                ),
                WearActionDialogButton(
                    text = stringResource(R.string.common_cancel),
                    onClick = onDismiss,
                    role = WearActionButtonRole.Secondary,
                ),
            ),
    ) {}
}

@Composable
@Suppress("FunctionNaming")
internal fun NavigateKeepAppOpenDialog(
    visible: Boolean,
    @Suppress("UNUSED_PARAMETER")
    helpDialogMaxHeight: Dp,
    onContinue: () -> Unit,
    onDismiss: () -> Unit,
) {
    WearActionDialog(
        visible = visible,
        title = stringResource(R.string.navigate_stay_open),
        onDismissRequest = onDismiss,
        buttons =
            listOf(
                WearActionDialogButton(
                    text = stringResource(R.string.common_continue),
                    onClick = onContinue,
                ),
                WearActionDialogButton(
                    text = stringResource(R.string.navigate_later),
                    onClick = onDismiss,
                    role = WearActionButtonRole.Secondary,
                ),
            ),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            KeepAppOpenInfoRow(
                imageVector = Icons.Filled.Visibility,
                text = stringResource(R.string.navigate_keeps_glancemap_active),
            )
            KeepAppOpenInfoRow(
                imageVector = Icons.Filled.VisibilityOff,
                text = stringResource(R.string.navigate_lets_the_watch_sleep_and_removes_it_from_recents),
            )
        }
    }
}

@Composable
@Suppress("FunctionNaming")
internal fun NavigateNotificationPermissionDialog(
    visible: Boolean,
    onContinue: () -> Unit,
    onDismiss: () -> Unit,
) {
    WearActionDialog(
        visible = visible,
        title = stringResource(R.string.navigate_notifications),
        onDismissRequest = onDismiss,
        buttons =
            listOf(
                WearActionDialogButton(
                    text = stringResource(R.string.common_continue),
                    onClick = onContinue,
                ),
                WearActionDialogButton(
                    text = stringResource(R.string.navigate_later),
                    onClick = onDismiss,
                    role = WearActionButtonRole.Secondary,
                ),
            ),
    ) {
        KeepAppOpenInfoRow(
            imageVector = Icons.Filled.Visibility,
            text = stringResource(R.string.navigate_stay_uses_notifications_while_glancemap_remains_active),
        )
    }
}

@Composable
@Suppress("FunctionNaming")
private fun KeepAppOpenInfoRow(
    imageVector: ImageVector,
    text: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = imageVector,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
        )
        Text(
            text = text,
        )
    }
}

@Composable
internal fun NavigateRouteToolDialogs(
    showRouteToolsPanel: Boolean,
    canModifyActiveGpx: Boolean,
    coordinateSeed: LatLong?,
    options: RouteToolOptions,
    preflightMessage: String?,
    onOptionsChange: (RouteToolOptions) -> Unit,
    onDismissRouteToolsPanel: () -> Unit,
    onOpenGpxToolsSettings: () -> Unit,
    onStartRouteToolSelection: (RouteToolSession) -> Unit,
    completedRouteToolDraft: RouteToolSession?,
    routeToolExecutionInProgress: Boolean,
    routeToolExecutionMessage: String?,
    routeToolLoopRetryOptions: List<RouteToolLoopRetryOption>,
    onDismissDraftSummary: () -> Unit,
    onConfirmCreateDraft: (() -> Unit)?,
    onConfirmModifyDraft: (() -> Unit)?,
    onSelectLoopRetryOption: (RouteToolLoopRetryOption) -> Unit,
    routeToolProgressVisible: Boolean,
    routeToolProgressMessage: String,
    routeToolResult: RouteToolSaveResult?,
    isMetric: Boolean,
    routeToolRenameInProgress: Boolean,
    routeToolRenameError: String?,
    onDismissRouteToolResult: () -> Unit,
    onDeleteRouteToolResult: () -> Unit,
    onOpenRouteToolRename: () -> Unit,
    onConfirmRouteToolRename: (String) -> Unit,
    onStartRouteToolGuidance: () -> Unit,
) {
    RouteToolsActionPanel(
        visible = showRouteToolsPanel,
        canModifyActiveGpx = canModifyActiveGpx,
        coordinateSeed = coordinateSeed,
        options = options,
        preflightMessage = preflightMessage,
        onOptionsChange = onOptionsChange,
        onDismiss = onDismissRouteToolsPanel,
        onStartSelection = onStartRouteToolSelection,
        onOpenGpxToolsSettings = onOpenGpxToolsSettings,
    )

    RouteToolDraftSummaryDialog(
        visible = completedRouteToolDraft != null,
        session = completedRouteToolDraft,
        isExecuting = routeToolExecutionInProgress,
        executionMessage = routeToolExecutionMessage,
        loopRetryOptions = routeToolLoopRetryOptions,
        onDismiss = onDismissDraftSummary,
        onConfirmCreate = onConfirmCreateDraft,
        onConfirmModify = onConfirmModifyDraft,
        onSelectLoopRetryOption = onSelectLoopRetryOption,
    )

    RouteToolProgressDialog(
        visible = routeToolProgressVisible,
        message = routeToolProgressMessage,
    )

    RouteToolResultDialog(
        visible = routeToolResult != null,
        result = routeToolResult,
        isMetric = isMetric,
        renameInProgress = routeToolRenameInProgress,
        renameError = routeToolRenameError,
        onDismiss = onDismissRouteToolResult,
        onDelete = onDeleteRouteToolResult,
        onRenameOpen = onOpenRouteToolRename,
        onRenameConfirm = onConfirmRouteToolRename,
        onStartGuidance = onStartRouteToolGuidance,
    )
}
