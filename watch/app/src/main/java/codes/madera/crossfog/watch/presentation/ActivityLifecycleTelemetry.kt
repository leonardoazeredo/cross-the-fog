package codes.madera.crossfog.watch.presentation

import codes.madera.crossfog.watch.core.service.diagnostics.DebugTelemetry
import codes.madera.crossfog.watch.core.service.diagnostics.FieldMarkerDiagnostics

internal data class ActivityTelemetryState(
    val route: String,
    val ambient: Boolean,
    val interactive: Boolean?,
)

internal object ActivityLifecycleTelemetry {
    fun logScreen(
        event: String,
        state: ActivityTelemetryState,
    ) {
        DebugTelemetry.log(
            "ScreenTelemetry",
            "event=$event route=${state.route} ambient=${state.ambient} " +
                "interactive=${state.interactive?.toString() ?: "na"}",
        )
        FieldMarkerDiagnostics.recordMarker(type = event, note = state.route)
    }

    fun logNavigation(
        event: String,
        state: ActivityTelemetryState,
    ) {
        DebugTelemetry.log(
            "NavigationTelemetry",
            "event=$event route=${state.route} ambient=${state.ambient} " +
                "interactive=${state.interactive?.toString() ?: "na"}",
        )
        FieldMarkerDiagnostics.recordMarker(type = event, note = state.route)
    }
}
