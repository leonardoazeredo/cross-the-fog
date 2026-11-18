package codes.madera.crossfog.watch.presentation.features.navigate

import android.content.Context
import android.os.Build
import android.os.Vibrator
import android.os.VibratorManager
import org.mapsforge.map.android.view.MapView
import kotlin.math.cos
import kotlin.math.log2
import kotlin.math.roundToInt

internal fun vibratorFrom(context: Context): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        vm.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

internal fun displayTargetCompassQuality(
    rawQuality: CompassMarkerQuality,
    nowElapsedMs: Long,
    lastCalibrationConfirmedAtElapsedMs: Long,
): CompassMarkerQuality {
    if (lastCalibrationConfirmedAtElapsedMs <= 0L) return rawQuality
    val sinceCalibrationMs = nowElapsedMs - lastCalibrationConfirmedAtElapsedMs
    return when {
        sinceCalibrationMs in 0 until COMPASS_POST_CALIBRATION_GREEN_HOLD_MS ->
            CompassMarkerQuality.GOOD
        rawQuality == CompassMarkerQuality.UNRELIABLE &&
            sinceCalibrationMs in 0 until COMPASS_POST_CALIBRATION_UNRELIABLE_FLOOR_MS ->
            CompassMarkerQuality.LOW
        else -> rawQuality
    }
}

internal fun applyCompassStartupWarmupGuard(
    rawQuality: CompassMarkerQuality,
    displayedQuality: CompassMarkerQuality,
    nowElapsedMs: Long,
    warmupUntilElapsedMs: Long,
): CompassMarkerQuality {
    if (nowElapsedMs >= warmupUntilElapsedMs) return rawQuality
    return if (compassMarkerQualityRank(rawQuality) < compassMarkerQualityRank(displayedQuality)) {
        displayedQuality
    } else {
        rawQuality
    }
}

internal fun compassMarkerQualityRank(quality: CompassMarkerQuality): Int =
    when (quality) {
        CompassMarkerQuality.NEUTRAL -> 0
        CompassMarkerQuality.UNRELIABLE -> 0
        CompassMarkerQuality.LOW -> 1
        CompassMarkerQuality.MEDIUM -> 2
        CompassMarkerQuality.GOOD -> 3
    }

internal const val COMPASS_QUALITY_STARTUP_GRACE_MS = 2_200L
internal const val COMPASS_POST_CALIBRATION_GREEN_HOLD_MS = 5_000L
internal const val COMPASS_POST_CALIBRATION_UNRELIABLE_FLOOR_MS = 12_000L
internal const val POI_FOCUS_TARGET_SCALE_METERS = 500.0
internal const val POI_SCALE_INDICATOR_TARGET_RATIO = 0.28
internal const val METERS_PER_PIXEL_EQUATOR_ZOOM_0 = 156543.03392804097
internal const val FALLBACK_POI_FOCUS_ZOOM = 14
