package codes.madera.crossfog.watch.presentation.features.navigate

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import codes.madera.crossfog.watch.R
import codes.madera.crossfog.watch.core.maps.GeoBounds
import codes.madera.crossfog.watch.presentation.ui.WearActionButtonRole
import codes.madera.crossfog.watch.presentation.ui.WearActionDialog
import codes.madera.crossfog.watch.presentation.ui.WearActionDialogButton
import org.mapsforge.core.model.LatLong

internal fun shouldShowMissingMapPrompt(
    location: LatLong?,
    installedBounds: List<GeoBounds?>?,
    disabled: Boolean,
    dismissed: Boolean,
    canShow: Boolean,
): Boolean {
    // Use every installed map, regardless of selection; uncertain coverage must not trigger a prompt.
    return when {
        disabled || dismissed || !canShow -> false
        location == null || installedBounds == null -> false
        !location.latitude.isFinite() || !location.longitude.isFinite() -> false
        else ->
            installedBounds.all { bounds ->
                bounds != null &&
                    (
                        location.latitude !in bounds.minLat..bounds.maxLat ||
                            location.longitude !in bounds.minLon..bounds.maxLon
                    )
            }
    }
}

@Composable
@Suppress("FunctionNaming")
internal fun MissingMapPrompt(
    visible: Boolean,
    onDownload: () -> Unit,
    onDismiss: () -> Unit,
    onNeverShowAgain: () -> Unit,
) {
    WearActionDialog(
        visible = visible,
        title = stringResource(R.string.navigation_missing_map_title),
        onDismissRequest = onDismiss,
        buttons =
            listOf(
                WearActionDialogButton(
                    text = stringResource(R.string.navigation_missing_map_download),
                    onClick = onDownload,
                ),
                WearActionDialogButton(
                    text = stringResource(R.string.navigation_missing_map_not_now),
                    onClick = onDismiss,
                    role = WearActionButtonRole.Secondary,
                ),
                WearActionDialogButton(
                    text = stringResource(R.string.navigation_missing_map_never_again),
                    onClick = onNeverShowAgain,
                    role = WearActionButtonRole.Secondary,
                ),
            ),
    ) {
        Text(
            text = stringResource(R.string.navigation_missing_map_message),
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )
    }
}
