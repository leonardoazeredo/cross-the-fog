package codes.madera.crossfog.watch

import android.app.Application
import android.content.res.Configuration
import codes.madera.crossfog.watch.core.localization.AppLanguageSettings
import codes.madera.crossfog.watch.core.service.diagnostics.CrashDiagnosticsStore
import codes.madera.crossfog.watch.core.service.diagnostics.DebugTelemetry
import codes.madera.crossfog.watch.core.service.transfer.storage.StalePartialTransferCleaner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class GlanceMapWearApp : Application() {
    // Global app-wide IO scope (NOT tied to any Activity/Service lifecycle)
    val applicationScope: CoroutineScope =
        CoroutineScope(
            SupervisorJob() + Dispatchers.IO,
        )

    lateinit var container: AppContainer
        private set

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        AppLanguageSettings.applyLegacy(this, newConfig)
    }

    override fun onCreate() {
        super.onCreate()
        AppLanguageSettings.initialize(this)
        CrashDiagnosticsStore.install(this)
        // Initialize the container when the app starts
        container = AppContainer(this, applicationScope)
        applicationScope.launch {
            DebugTelemetry.observeCaptureSettings(
                captureActive = container.settingsRepository.gpsDebugTelemetry,
                captureMode = container.settingsRepository.diagnosticsCaptureMode,
            )
        }
        applicationScope.launch {
            StalePartialTransferCleaner.cleanStale(this@GlanceMapWearApp)
        }
    }
}
