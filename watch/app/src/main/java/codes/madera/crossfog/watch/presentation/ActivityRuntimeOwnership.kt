package codes.madera.crossfog.watch.presentation

internal fun activityOwnsNavigationRuntime(
    isNavigateScreen: Boolean,
    isAmbient: Boolean,
): Boolean = !isNavigateScreen || isAmbient
