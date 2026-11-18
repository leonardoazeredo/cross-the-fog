package codes.madera.crossfog.watch.core.service.transfer.notifications
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import codes.madera.crossfog.watch.R
import kotlin.math.abs

class NotificationHelper(
    private val service: Service,
) {
    companion object {
        const val CHANNEL_ID = "DataLayerListenerChannel"

        // Throttle notification refresh
        private const val MIN_UPDATE_INTERVAL_MS = 1000L
        private const val MIN_UPDATE_PROGRESS_STEP = 4 // percent
    }

    private val notificationManager by lazy {
        service.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    }

    private var lastUpdateTimeMs: Long = 0L
    private var lastProgress: Int = -999
    private var lastStatus: String = ""
    private var notificationChannelCreated = false

    @Synchronized
    fun createNotificationChannel() {
        if (notificationChannelCreated) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel =
                NotificationChannel(
                    CHANNEL_ID,
                    service.resources.getString(R.string.gpx_file_transfers),
                    NotificationManager.IMPORTANCE_LOW,
                )
            notificationManager.createNotificationChannel(channel)
        }
        notificationChannelCreated = true
    }

    /** Foreground (non-swipeable) */
    fun startForeground(
        notificationId: Int,
        fileName: String,
        status: String,
    ) {
        createNotificationChannel()
        val foregroundServiceType =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            } else {
                0
            }

        // Reset throttling
        lastUpdateTimeMs = 0L
        lastProgress = -999
        lastStatus = ""

        ServiceCompat.startForeground(
            service,
            notificationId,
            buildForegroundNotification(fileName, status, -1).build(),
            foregroundServiceType,
        )
    }

    /** Update the foreground notification while transferring */
    fun updateForeground(
        notificationId: Int,
        fileName: String,
        status: String,
        progress: Int,
    ) {
        val now = SystemClock.elapsedRealtime()

        val statusChanged = status != lastStatus
        val progressDeltaOk =
            (abs(progress - lastProgress) >= MIN_UPDATE_PROGRESS_STEP) || lastProgress == -999
        val timeOk = (now - lastUpdateTimeMs) >= MIN_UPDATE_INTERVAL_MS

        if (!statusChanged && !timeOk && !progressDeltaOk) return

        lastUpdateTimeMs = now
        lastProgress = progress
        lastStatus = status

        notificationManager.notify(
            notificationId,
            buildForegroundNotification(fileName, status, progress).build(),
        )
    }

    /**
     * Stop foreground and REMOVE the foreground notification.
     * (Then you can post a normal swipeable notification.)
     */
    fun stopForeground(notificationId: Int? = null) {
        ServiceCompat.stopForeground(service, ServiceCompat.STOP_FOREGROUND_REMOVE)
        // extra safety: ensure the old foreground notif id is cleared
        notificationId?.let(notificationManager::cancel)
    }

    private fun buildForegroundNotification(
        fileName: String,
        status: String,
        progress: Int,
    ): NotificationCompat.Builder {
        val builder =
            NotificationCompat
                .Builder(service, CHANNEL_ID)
                .setContentTitle(service.getString(R.string.download_receiving, fileName))
                .setContentText(status)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setOngoing(true) // <-- this makes it non-swipeable
                .setOnlyAlertOnce(true)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)

        return if (progress < 0) {
            builder.setProgress(0, 0, true) // indeterminate
        } else {
            builder.setProgress(100, progress.coerceIn(0, 100), false)
        }
    }
}
