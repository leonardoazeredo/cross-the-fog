package codes.madera.crossfog.watch.link

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import codes.madera.crossfog.watch.GlanceMapWearApp
import codes.madera.crossfog.watch.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The Link row in settings: only says what is stored. It has no control, because nothing here can pair yet. */
@Composable
internal fun LinkSettingsRow() {
    val context = LocalContext.current
    var status by remember { mutableStateOf<WatchLinkStatus?>(null) }
    LaunchedEffect(Unit) {
        status =
            withContext(Dispatchers.IO) {
                (context.applicationContext as GlanceMapWearApp).container.watchLink.status()
            }
    }
    val shown = status ?: return
    Column {
        Text(stringResource(R.string.settings_link), style = MaterialTheme.typography.titleMedium)
        Text(
            if (shown.paired) stringResource(R.string.settings_link_paired) else stringResource(R.string.settings_link_not_paired),
            style = MaterialTheme.typography.bodySmall,
        )
        if (shown.asideWalks > 0) {
            Text(stringResource(R.string.settings_link_walks_not_sent, shown.asideWalks), style = MaterialTheme.typography.bodySmall)
        }
    }
}
