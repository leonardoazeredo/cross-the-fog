package codes.madera.crossfog.watch.presentation.features.settings

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import codes.madera.crossfog.watch.R

@Suppress("FunctionName")
@Composable
internal fun GpxSettingsShortcutChip(onClick: () -> Unit) {
    AdaptiveSettingsShortcutChip(
        standardLabel = stringResource(R.string.settings_gpx_settings),
        compactLabel = stringResource(R.string.common_gpx),
        standardSecondaryLabel = stringResource(R.string.settings_back_to_gpx_settings),
        compactSecondaryLabel = stringResource(R.string.common_back),
        iconImageVector = Icons.Filled.Folder,
        applyTopPadding = true,
        compactRoundWidthFraction = 0.78f,
        onClick = onClick,
    )
}
