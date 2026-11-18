package codes.madera.crossfog.watch.core.service.location.policy

internal object LocationSourceGuard {
    fun acceptsCallbackOrigin(
        expectedSourceMode: LocationSourceMode,
        callbackOrigin: LocationSourceMode,
    ): Boolean = expectedSourceMode == callbackOrigin

    fun expectedOrigin(sourceMode: LocationSourceMode): String = sourceMode.telemetryValue
}
