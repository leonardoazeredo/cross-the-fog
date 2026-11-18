package codes.madera.crossfog.watch.presentation.features.navigate

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import com.caverock.androidsvg.PreserveAspectRatio
import com.caverock.androidsvg.SVG
import codes.madera.crossfog.watch.data.repository.SettingsRepository
import codes.madera.crossfog.watch.presentation.features.maps.RotatableMarker
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.mapsforge.core.model.LatLong
import org.mapsforge.map.android.graphics.AndroidBitmap
import org.mapsforge.map.layer.Layer
import org.mapsforge.map.layer.Layers
import org.mapsforge.map.layer.overlay.Marker
import kotlin.math.roundToInt

internal fun createGpxDirectionArrowBitmap(sizePx: Int = 16): Bitmap {
    val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(android.graphics.Color.TRANSPARENT, android.graphics.PorterDuff.Mode.CLEAR)

    val arrow =
        Path().apply {
            moveTo(sizePx * 0.5f, sizePx * 0.12f)
            lineTo(sizePx * 0.82f, sizePx * 0.82f)
            lineTo(sizePx * 0.5f, sizePx * 0.66f)
            lineTo(sizePx * 0.18f, sizePx * 0.82f)
            close()
        }
    val haloPaint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            style = Paint.Style.STROKE
            strokeJoin = Paint.Join.ROUND
            strokeWidth = sizePx * 0.14f
            alpha = 225
        }
    val fillPaint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.BLACK
            style = Paint.Style.FILL
        }

    canvas.drawPath(arrow, haloPaint)
    canvas.drawPath(arrow, fillPaint)
    return bitmap
}

private fun RectF.offsetCopy(
    dx: Float,
    dy: Float,
): RectF =
    RectF(
        left + dx,
        top + dy,
        right + dx,
        bottom + dy,
    )

internal fun ensureTopOverlayOrder(
    layers: Layers,
    accuracyCircleLayer: GpsAccuracyCircleLayer?,
    coneLayer: CompassConeLayer?,
    locationMarker: RotatableMarker?,
    markerA: Marker?,
    markerB: Marker?,
): Boolean {
    val desiredTopOrder =
        buildList<Layer>(5) {
            if (
                accuracyCircleLayer != null &&
                layers.contains(accuracyCircleLayer) &&
                accuracyCircleLayer.isVisible
            ) {
                add(accuracyCircleLayer)
            }
            if (coneLayer != null && layers.contains(coneLayer)) add(coneLayer)
            if (locationMarker != null && layers.contains(locationMarker)) add(locationMarker)
            if (markerA != null && layers.contains(markerA)) add(markerA)
            if (markerB != null && layers.contains(markerB)) add(markerB)
        }
    if (desiredTopOrder.isEmpty()) return false
    val layerCount = layers.size()
    if (layerCount < desiredTopOrder.size) return false

    val startIndex = layerCount - desiredTopOrder.size
    val alreadyOrdered =
        desiredTopOrder.indices.all { i ->
            layers.get(startIndex + i) === desiredTopOrder[i]
        }
    if (alreadyOrdered) return false

    desiredTopOrder.forEach { layer -> layers.remove(layer) }
    desiredTopOrder.forEach { layer -> layers.add(layer) }
    return true
}

internal fun setMarkerLatLongIfChanged(
    marker: Marker,
    target: LatLong,
): Boolean {
    val current = marker.latLong
    if (current.latitude == target.latitude && current.longitude == target.longitude) {
        return false
    }
    marker.latLong = target
    return true
}

internal fun applyOpacityToColor(
    color: Int,
    opacityPercent: Int,
): Int {
    val clampedPercent = opacityPercent.coerceIn(0, 100)
    val alpha = ((clampedPercent / 100f) * 255f).roundToInt()
    return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
}

internal fun sanitizeGpsAccuracyMeters(rawAccuracyMeters: Float): Float? {
    if (!rawAccuracyMeters.isFinite() || rawAccuracyMeters <= 0f) return null
    return rawAccuracyMeters.coerceIn(
        GPS_ACCURACY_CIRCLE_MIN_RADIUS_METERS,
        GPS_ACCURACY_CIRCLE_MAX_RADIUS_METERS,
    )
}

private const val GPS_ACCURACY_CIRCLE_MIN_RADIUS_METERS = 3f
private const val GPS_ACCURACY_CIRCLE_MAX_RADIUS_METERS = 250f
