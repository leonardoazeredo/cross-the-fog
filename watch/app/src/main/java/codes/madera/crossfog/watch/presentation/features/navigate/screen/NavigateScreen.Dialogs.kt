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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
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
import codes.madera.crossfog.watch.presentation.ui.RenameValueDialog
import codes.madera.crossfog.watch.presentation.ui.WearActionButtonRole
import codes.madera.crossfog.watch.presentation.ui.WearActionDialog
import codes.madera.crossfog.watch.presentation.ui.WearActionDialogButton
import codes.madera.crossfog.watch.presentation.ui.WearFormDialog

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
) {
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
