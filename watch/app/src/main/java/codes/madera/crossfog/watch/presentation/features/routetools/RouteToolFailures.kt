package codes.madera.crossfog.watch.presentation.features.routetools

import android.content.res.Resources
import androidx.annotation.StringRes

// Stable diagnostics remain available to tests and logs; the UI resolves the resource ID.
internal class RouteToolArgumentException(
    @StringRes val messageRes: Int,
    diagnostic: String,
) : IllegalArgumentException(diagnostic)

internal fun Throwable.routeToolFailureMessage(resources: Resources): String? =
    when (this) {
        is RouteToolArgumentException -> resources.getString(messageRes)
        else -> localizedMessage
    }
