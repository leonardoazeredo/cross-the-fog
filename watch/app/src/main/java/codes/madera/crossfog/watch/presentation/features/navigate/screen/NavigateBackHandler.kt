package codes.madera.crossfog.watch.presentation.features.navigate

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import codes.madera.crossfog.watch.core.service.diagnostics.DebugTelemetry
import codes.madera.crossfog.watch.data.repository.SettingsRepository

@Composable
@Suppress("LongParameterList", "FunctionNaming")
internal fun NavigateBackHandler(
    mapFocusMode: Boolean,
    onExitMapFocus: () -> Unit,
    shortcutTrayExpanded: Boolean,
    backButtonExitsNavigation: Boolean,
    backButtonClosesApp: Boolean,
    onCloseApp: () -> Unit,
    onDismissShortcutTray: () -> Unit,
    onMenuClick: () -> Unit,
) {
    BackHandler(enabled = !mapFocusMode) {
        when {
            shortcutTrayExpanded -> onDismissShortcutTray()
            else ->
                handleNavigateBackWithoutOverlay(
                    backButtonExitsNavigation = backButtonExitsNavigation,
                    backButtonClosesApp = backButtonClosesApp,
                    onMenuClick = onMenuClick,
                    onCloseApp = onCloseApp,
                )
        }
    }
    BackHandler(enabled = mapFocusMode, onBack = onExitMapFocus)
}

internal fun handleNavigateBackWithoutOverlay(
    backButtonExitsNavigation: Boolean,
    backButtonClosesApp: Boolean = SettingsRepository.DEFAULT_BACK_BUTTON_CLOSES_APP,
    onMenuClick: () -> Unit,
    onCloseApp: () -> Unit,
) {
    when {
        backButtonClosesApp -> {
            DebugTelemetry.log(
                "NavigationTelemetry",
                "event=navigate_back_close_app route=navigate_screen reason=no_overlay_open",
            )
            onCloseApp()
        }
        backButtonExitsNavigation -> {
            DebugTelemetry.log(
                "NavigationTelemetry",
                "event=navigate_back_to_menu route=navigate_screen reason=no_overlay_open compat=true",
            )
            onMenuClick()
        }
        else -> {
            DebugTelemetry.log(
                "NavigationTelemetry",
                "event=navigate_back_ignored route=navigate_screen reason=no_overlay_open compat=false",
            )
        }
    }
}
