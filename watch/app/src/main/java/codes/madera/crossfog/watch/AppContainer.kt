package codes.madera.crossfog.watch

import android.app.Application
import android.content.Context
import android.util.Log
import codes.madera.crossfog.watch.core.maps.theme.validateExternalRenderTheme
import codes.madera.crossfog.watch.data.repository.*
import codes.madera.crossfog.watch.data.repository.maps.theme.ExternalThemeStore
import codes.madera.crossfog.watch.data.repository.maps.theme.ThemeRepository
import codes.madera.crossfog.watch.data.repository.maps.theme.ThemeRepositoryImpl
import codes.madera.crossfog.watch.domain.sensors.CompassViewModel
import codes.madera.crossfog.watch.link.WatchLink
import codes.madera.crossfog.watch.link.createWatchLink
import codes.madera.crossfog.watch.presentation.SyncManager
import codes.madera.crossfog.watch.presentation.features.download.DownloadViewModel
import codes.madera.crossfog.watch.presentation.features.download.OamBundleDownloader
import codes.madera.crossfog.watch.presentation.features.download.OamDownloadNetworkMonitor
import codes.madera.crossfog.watch.presentation.features.download.OamDownloadNotificationController
import codes.madera.crossfog.watch.presentation.features.download.OamDownloadServiceClient
import codes.madera.crossfog.watch.presentation.features.gpx.GpxRouteServices
import codes.madera.crossfog.watch.presentation.features.gpx.GpxViewModel
import codes.madera.crossfog.watch.presentation.features.maps.MapViewModel
import codes.madera.crossfog.watch.presentation.features.maps.theme.ThemeViewModel
import codes.madera.crossfog.watch.presentation.features.navigate.LocationViewModel
import codes.madera.crossfog.watch.presentation.features.recording.RecordingElevationProvider
import codes.madera.crossfog.watch.presentation.features.recording.RecordingRuntimeDependencies
import codes.madera.crossfog.watch.presentation.features.recording.TraceRecordingDraftStore
import codes.madera.crossfog.watch.presentation.features.recording.TraceRecordingViewModel
import codes.madera.crossfog.watch.presentation.features.recording.health.RecordingHealthRuntime
import codes.madera.crossfog.watch.presentation.features.recording.sensors.AndroidRecordingExperimentLock
import codes.madera.crossfog.watch.presentation.features.recording.sensors.RecordingWakeLockExperiment
import codes.madera.crossfog.watch.presentation.features.settings.SettingsViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.io.File

class AppContainer(
    private val applicationContext: Context,
    private val coroutineScope: CoroutineScope,
) {
    internal val recordingHealthRuntime = RecordingHealthRuntime(applicationContext)
    internal val recordingWakeLockExperiment =
        RecordingWakeLockExperiment(
            enabled = BuildConfig.RECORDING_WAKE_LOCK_EXPERIMENT,
            createLock = { AndroidRecordingExperimentLock(applicationContext) },
            diagnostic = { event ->
                codes.madera.crossfog.watch.core.service.diagnostics.DebugTelemetry
                    .log("TraceRecordingSensors", event)
            },
        )
    val syncManager: SyncManager by lazy { SyncManager(scope = coroutineScope) }

    val settingsRepository: SettingsRepository by lazy {
        SettingsRepositoryImpl.getInstance(applicationContext)
    }

    val gpxRepository: GpxRepositoryImpl by lazy {
        GpxRepositoryImpl(applicationContext)
    }

    internal val watchLink: WatchLink by lazy {
        createWatchLink(applicationContext, gpxRepository)
    }

    val mapRepository: MapRepositoryImpl by lazy {
        MapRepositoryImpl(applicationContext)
    }

    val externalThemeStore: ExternalThemeStore by lazy {
        ExternalThemeStore(
            root = File(applicationContext.filesDir, "mapsforge-themes"),
            validateTheme = { validateExternalRenderTheme(applicationContext, it) },
            diagnostic = { event, id -> Log.i("CustomThemes", "event=$event id=$id") },
        )
    }

    val themeRepository: ThemeRepository by lazy {
        ThemeRepositoryImpl(applicationContext, settingsRepository.selectedMapPath, externalThemeStore)
    }

    val compassViewModel: CompassViewModel by lazy {
        CompassViewModel(applicationContext as Application)
    }

    val gpxViewModel: GpxViewModel by lazy {
        GpxViewModel(
            resources = applicationContext.resources,
            gpxRepository = gpxRepository,
            syncManager = syncManager,
            settingsRepository = settingsRepository,
            routeServices =
                GpxRouteServices(
                    elevationProvider = RecordingElevationProvider(applicationContext),
                ),
        )
    }

    val mapViewModel: MapViewModel by lazy {
        // ✅ FIX: MapViewModel expects context first
        MapViewModel(
            context = applicationContext,
            settingsRepository = settingsRepository,
            mapRepository = mapRepository,
            syncManager = syncManager,
            themeRepository = themeRepository,
        )
    }

    val downloadViewModel: DownloadViewModel by lazy {
        DownloadViewModel(
            resources = applicationContext.resources,
            downloader =
                OamBundleDownloader(
                    context = applicationContext,
                    mapRepository = mapRepository,
                ),
            notificationController = OamDownloadNotificationController(applicationContext),
            networkMonitor = OamDownloadNetworkMonitor(applicationContext),
            settingsRepository = settingsRepository,
            downloadServiceClient = OamDownloadServiceClient(applicationContext),
        )
    }

    val themeViewModel: ThemeViewModel by lazy {
        ThemeViewModel(
            themeRepository = themeRepository,
            context = applicationContext,
            settingsRepository = settingsRepository,
        )
    }

    val settingsViewModel: SettingsViewModel by lazy {
        SettingsViewModel(settingsRepository)
    }

    val locationViewModel: LocationViewModel by lazy {
        LocationViewModel(
            application = applicationContext as Application,
            settingsRepository = settingsRepository,
        )
    }

    val traceRecordingViewModel: TraceRecordingViewModel by lazy {
        val viewModel =
            TraceRecordingViewModel(
                resources = applicationContext.resources,
                gpxRepository = gpxRepository,
                settingsRepository = settingsRepository,
                syncManager = syncManager,
                elevationProvider = RecordingElevationProvider(applicationContext),
                draftStore = TraceRecordingDraftStore(applicationContext),
                onRecordingSaved = { bytes -> watchLink.recordingHook.onSaved(bytes) },
                runtimeDependencies =
                    RecordingRuntimeDependencies(
                        applicationContext = applicationContext,
                        requestImmediateLocation = { source ->
                            locationViewModel.requestImmediateLocation(source = source)
                        },
                    ),
            )
        startRecordingLocationBridge(viewModel)
        viewModel
    }

    private fun startRecordingLocationBridge(traceRecordingViewModel: TraceRecordingViewModel) {
        recordingHealthRuntime.bind(traceRecordingViewModel, settingsRepository, coroutineScope)
        coroutineScope.launch(Dispatchers.Main.immediate) {
            traceRecordingViewModel.recordingPresentationState.collect { state ->
                recordingWakeLockExperiment.update(active = state.active && !state.saving, paused = state.paused)
            }
        }
        coroutineScope.launch(Dispatchers.Main.immediate) {
            locationViewModel.recordingLocations.collect { location ->
                traceRecordingViewModel.onLocation(location)?.join()
            }
        }
        coroutineScope.launch(Dispatchers.Main.immediate) {
            locationViewModel.gpsSignalSnapshot.collectLatest { snapshot ->
                traceRecordingViewModel.onGpsSignalSnapshot(snapshot)
            }
        }
        coroutineScope.launch(Dispatchers.Main.immediate) {
            locationViewModel.effectiveGpsIntervalMs.collect { intervalMs ->
                traceRecordingViewModel.onEffectiveRecordingSamplingIntervalChanged(intervalMs)
            }
        }
    }
}
