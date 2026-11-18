package codes.madera.crossfog.watch.presentation.features.routetools

internal fun buildRenamedGpxFileName(title: String): String = "${sanitizeFileStem(title)}.gpx"

internal fun sanitizeFileStem(input: String): String =
    input
        .replace(Regex("\\.gpx$", RegexOption.IGNORE_CASE), "")
        .replace(Regex("[^A-Za-z0-9._-]+"), "-")
        .trim('-')
        .ifBlank { "gpx-edit" }
