package codes.madera.crossfog.watch.presentation.features.navigate

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

internal fun unrotateTouchToMapSpace(
    point: ScreenAnchor,
    mapWidth: Double,
    mapHeight: Double,
    mapRotationDeg: Double,
    pivot: ScreenAnchor = ScreenAnchor(mapWidth / 2.0, mapHeight / 2.0),
): ScreenAnchor {
    if (mapWidth <= 0.0 || mapHeight <= 0.0 || abs(mapRotationDeg) < 0.001) return point

    // Convert screen point back into unrotated map content coordinates.
    val rad = Math.toRadians(-mapRotationDeg)
    val c = cos(rad)
    val s = sin(rad)

    val dx = point.x - pivot.x
    val dy = point.y - pivot.y

    val rx = dx * c - dy * s
    val ry = dx * s + dy * c

    return ScreenAnchor(pivot.x + rx, pivot.y + ry)
}
