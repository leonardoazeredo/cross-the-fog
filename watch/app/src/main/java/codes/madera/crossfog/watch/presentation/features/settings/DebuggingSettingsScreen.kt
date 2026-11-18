@file:Suppress("LongMethod")

package codes.madera.crossfog.watch.presentation.features.settings

import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import codes.madera.crossfog.watch.BuildConfig
import codes.madera.crossfog.watch.R
import codes.madera.crossfog.watch.core.service.diagnostics.CompassDeepTraceDiagnostics
import codes.madera.crossfog.watch.core.service.diagnostics.CompassHeadingDiagnostics
import codes.madera.crossfog.watch.core.service.diagnostics.CompassHeadingReferenceBasis
import codes.madera.crossfog.watch.core.service.diagnostics.CompassHeadingReferenceDiagnostics
import codes.madera.crossfog.watch.core.service.diagnostics.CrashDiagnosticsStore
import codes.madera.crossfog.watch.core.service.diagnostics.DebugTelemetry
import codes.madera.crossfog.watch.core.service.diagnostics.DemDownloadDiagnostics
import codes.madera.crossfog.watch.core.service.diagnostics.EnergyDiagnostics
import codes.madera.crossfog.watch.core.service.diagnostics.FieldMarkerDiagnostics
import codes.madera.crossfog.watch.core.service.diagnostics.GnssDiagnostics
import codes.madera.crossfog.watch.core.service.diagnostics.MapHotPathDiagnostics
import codes.madera.crossfog.watch.core.service.diagnostics.RecordingScreenOffDiagnostics
import codes.madera.crossfog.watch.core.service.diagnostics.ScreenStateDiagnostics
import codes.madera.crossfog.watch.core.service.diagnostics.TelemetryFormatters
import codes.madera.crossfog.watch.core.service.diagnostics.TerrainDiagnostics
import codes.madera.crossfog.watch.data.repository.SettingsRepository
import codes.madera.crossfog.watch.presentation.features.navigate.motion.MarkerMotionTelemetry
import codes.madera.crossfog.watch.presentation.features.recording.external.ExternalSensorSimulation
import kotlinx.coroutines.delay
import androidx.wear.compose.material.Text as WearText

private const val DEBUG_HELP_PREFS = "debug_settings_help_prefs"
private val CLEAN_CAPTURE_DEFAULT_LABEL = R.string.debug_clear_all_captured_logs
private val CLEAN_CAPTURE_CLEARED_LABEL = R.string.debug_all_captured_logs_have_been_cleared
private const val CLEAN_CAPTURE_RESET_DELAY_MS = 3500L

@Composable
@Suppress("FunctionNaming")
private fun DiagnosticsSettingsSectionTitle() {
    Text(
        text = stringResource(R.string.common_settings),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.fillMaxWidth(),
        textAlign = TextAlign.Center,
        maxLines = 1,
    )
}

@Composable
fun DebuggingSettingsScreen(
    viewModel: SettingsViewModel,
    onOpenGeneralSettings: () -> Unit,
) {
    val resources = LocalResources.current
    val listTokens = rememberSettingsListTokens()
    val context = LocalContext.current
    val compassDeepTraceState by CompassDeepTraceDiagnostics.state.collectAsState()
    val compassHeadingReferenceTestActive by CompassHeadingReferenceDiagnostics.active.collectAsState()
    val compassHeadingReferenceBasis by CompassHeadingReferenceDiagnostics.referenceBasis.collectAsState()

    val gpsIntervalMs by viewModel.gpsInterval.collectAsState()
    val isWatchGpsOnly by viewModel.watchGpsOnly.collectAsState()
    val keepAppOpen by viewModel.keepAppOpen.collectAsState()
    val gpsInAmbientMode by viewModel.gpsInAmbientMode.collectAsState()
    val gpsDebugTelemetry by viewModel.gpsDebugTelemetry.collectAsState()
    val diagnosticsCaptureMode by viewModel.diagnosticsCaptureMode.collectAsState()
    val gpsPassiveLocationExperiment by viewModel.gpsPassiveLocationExperiment.collectAsState()
    val backButtonExitsNavigation by viewModel.backButtonExitsNavigation.collectAsState()
    val backButtonClosesApp by viewModel.backButtonClosesApp.collectAsState()
    val gpsDebugTelemetryPopupEnabled by
        viewModel.gpsDebugTelemetryPopupEnabled.collectAsState(
            initial = SettingsRepository.DEFAULT_GPS_DEBUG_TELEMETRY_POPUP_ENABLED,
        )
    val turnByTurnGuidanceSource by viewModel.turnByTurnGuidanceSource.collectAsState()
    val turnByTurnHapticsEnabled by viewModel.turnByTurnHapticsEnabled.collectAsState()
    val turnByTurnVoiceGuidanceEnabled by viewModel.turnByTurnVoiceGuidanceEnabled.collectAsState()
    val turnByTurnTurnAlertsMode by viewModel.turnByTurnTurnAlertsMode.collectAsState()
    val turnByTurnOffRouteAlertsEnabled by viewModel.turnByTurnOffRouteAlertsEnabled.collectAsState()
    val turnByTurnCompactPopupEnabled by viewModel.turnByTurnCompactPopupEnabled.collectAsState()
    val turnByTurnOffRouteThresholdMeters by viewModel.turnByTurnOffRouteAlertThresholdMeters.collectAsState()
    val turnByTurnOffRouteRepeatSeconds by viewModel.turnByTurnOffRouteRepeatSeconds.collectAsState()
    val turnByTurnGpsInAmbientMode by viewModel.turnByTurnGpsInAmbientMode.collectAsState()
    val turnByTurnScreenOffBatchingEnabled by viewModel.turnByTurnScreenOffBatchingEnabled.collectAsState()
    val turnByTurnGpsIntervalSeconds by viewModel.turnByTurnGpsIntervalSeconds.collectAsState()
    val turnByTurnScreenOffGpsIntervalSeconds by viewModel.turnByTurnScreenOffGpsIntervalSeconds.collectAsState()
    val turnByTurnBrouterGuideBackEnabled by viewModel.turnByTurnBrouterGuideBackEnabled.collectAsState()
    val turnByTurnRouteStartBehavior by viewModel.turnByTurnRouteStartBehavior.collectAsState()
    val turnByTurnReverseSuggestionMode by viewModel.turnByTurnReverseSuggestionMode.collectAsState()
    val recordingSampleIntervalSeconds by viewModel.recordingSampleIntervalSeconds.collectAsState()
    val recordingScreenOffSampleIntervalSeconds by viewModel.recordingScreenOffSampleIntervalSeconds.collectAsState()
    val recordingAutoPauseMode by viewModel.recordingAutoPauseMode.collectAsState()
    val recordingTrackSmoothingMode by viewModel.recordingTrackSmoothingMode.collectAsState()
    val recordingElevationSource by viewModel.recordingElevationSource.collectAsState()
    val recordingHeartRateSource by viewModel.recordingHeartRateSource.collectAsState()
    val recordingCadenceSource by viewModel.recordingCadenceSource.collectAsState()
    val recordingSpeedSource by viewModel.recordingSpeedSource.collectAsState()
    val recordingDistanceSource by viewModel.recordingDistanceSource.collectAsState()
    val recordingStepsSource by viewModel.recordingStepsSource.collectAsState()
    val recordingShowSavedGpxOnMap by viewModel.recordingShowSavedGpxOnMap.collectAsState()
    val recordingStartWithTurnByTurn by viewModel.recordingStartWithTurnByTurn.collectAsState()
    val recordingExternalHeartRateAddress by viewModel.recordingExternalHeartRateAddress.collectAsState()
    val recordingExternalHeartRateName by viewModel.recordingExternalHeartRateName.collectAsState()
    val recordingExternalRunPodAddress by viewModel.recordingExternalRunPodAddress.collectAsState()
    val recordingExternalRunPodName by viewModel.recordingExternalRunPodName.collectAsState()
    val externalSensorSimulationEnabled by ExternalSensorSimulation.enabled.collectAsState()
    val activityProfile by viewModel.activityProfile.collectAsState()
    val userWeightKg by viewModel.userWeightKg.collectAsState()
    val backpackWeightKg by viewModel.backpackWeightKg.collectAsState()
    val bikeWeightKg by viewModel.bikeWeightKg.collectAsState()
    var cleanCaptureStatus by remember {
        mutableStateOf(resources.getString(CLEAN_CAPTURE_DEFAULT_LABEL))
    }
    var cleanCaptureResetToken by remember { mutableStateOf(0L) }
    var energySummaryRevision by remember { mutableStateOf(0L) }
    val lastBatteryUse =
        remember(energySummaryRevision, gpsDebugTelemetry) {
            EnergyDiagnostics.summary().batteryUse
        }
    val batteryBenchmarkValidity = EnergyDiagnostics.batteryBenchmarkValidity()

    LaunchedEffect(gpsDebugTelemetry, diagnosticsCaptureMode) {
        if (gpsDebugTelemetry) {
            val fullDiagnostics =
                diagnosticsCaptureMode == SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_FULL
            EnergyDiagnostics.configure(
                captureActive = true,
                fullDiagnostics = fullDiagnostics,
            )
            ScreenStateDiagnostics.configure(captureActive = true)
            CompassHeadingDiagnostics.reset()
            DebugTelemetry.log(
                "DiagnosticsFlow",
                "capture enabled mode=$diagnosticsCaptureMode",
            )
            EnergyDiagnostics.recordSample(
                context = context,
                reason = "capture_toggle_on",
                detail = "source=debug_screen captureMode=$diagnosticsCaptureMode",
            )
        } else {
            EnergyDiagnostics.recordEvent(
                reason = "capture_toggle_off",
                detail = "source=debug_screen",
            )
            CompassHeadingDiagnostics.flush(reason = "capture_toggle_off")
            CompassHeadingDiagnostics.reset()
            EnergyDiagnostics.configure(captureActive = false, fullDiagnostics = false)
            ScreenStateDiagnostics.configure(captureActive = false)
        }
    }

    LaunchedEffect(cleanCaptureResetToken) {
        if (cleanCaptureResetToken <= 0L) return@LaunchedEffect
        delay(CLEAN_CAPTURE_RESET_DELAY_MS)
        if (cleanCaptureStatus == resources.getString(CLEAN_CAPTURE_CLEARED_LABEL)) {
            cleanCaptureStatus = resources.getString(CLEAN_CAPTURE_DEFAULT_LABEL)
        }
    }

    WearSettingsListScreen(listTokens = listTokens, horizontalAlignment = Alignment.CenterHorizontally) {
        item {
            GeneralSettingsShortcutChip(
                onClick = onOpenGeneralSettings,
                applyTopPadding = false,
            )
        }

        item {
            Chip(
                modifier = Modifier.fillMaxWidth(),
                label = {
                    WearText(
                        text = stringResource(R.string.settings_1_clean_previous_logs),
                        modifier = Modifier.fillMaxWidth().basicMarquee(),
                        textAlign = TextAlign.Start,
                        overflow = TextOverflow.Visible,
                        maxLines = 1,
                    )
                },
                secondaryLabel =
                    {
                        WearText(
                            text = cleanCaptureStatus,
                            modifier = Modifier.basicMarquee(),
                            overflow = TextOverflow.Visible,
                            maxLines = 1,
                        )
                    },
                onClick = {
                    CompassHeadingReferenceDiagnostics.stop()
                    DebugTelemetry.clear()
                    CompassHeadingDiagnostics.reset()
                    CompassDeepTraceDiagnostics.clear()
                    MarkerMotionTelemetry.clear()
                    EnergyDiagnostics.clear()
                    RecordingScreenOffDiagnostics.clear()
                    ScreenStateDiagnostics.clear()
                    energySummaryRevision += 1L
                    DemDownloadDiagnostics.clear()
                    FieldMarkerDiagnostics.clear()
                    GnssDiagnostics.clear()
                    MapHotPathDiagnostics.clear()
                    TerrainDiagnostics.clear()
                    CrashDiagnosticsStore.clear(context)
                    cleanCaptureStatus = resources.getString(CLEAN_CAPTURE_CLEARED_LABEL)
                    cleanCaptureResetToken += 1L
                },
            )
        }

        item {
            SettingsToggleChip(
                checked = gpsDebugTelemetry,
                onCheckedChanged = {
                    if (!it) {
                        EnergyDiagnostics.recordSample(
                            context = context,
                            reason = "capture_toggle_off",
                            detail = "source=capture_toggle",
                        )
                        energySummaryRevision += 1L
                    }
                    viewModel.setGpsDebugTelemetry(it)
                    FieldMarkerDiagnostics.recordMarker(
                        type = if (it) "capture_start" else "capture_stop",
                        note = "source=capture_toggle",
                    )
                },
                label = stringResource(R.string.settings_2_start_capturing),
                secondaryLabel =
                    if (gpsDebugTelemetry) {
                        if (diagnosticsCaptureMode == SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_BATTERY) {
                            if (!batteryBenchmarkValidity.valid) {
                                stringResource(R.string.settings_battery_benchmark_invalid_deep_trace_used)
                            } else {
                                stringResource(R.string.settings_battery_benchmark_running)
                            }
                        } else {
                            stringResource(R.string.settings_general_diagnostics_running)
                        }
                    } else if (
                        diagnosticsCaptureMode == SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_BATTERY &&
                        !batteryBenchmarkValidity.valid
                    ) {
                        stringResource(R.string.settings_last_run_invalid_deep_trace_used)
                    } else if (
                        diagnosticsCaptureMode == SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_BATTERY &&
                        lastBatteryUse != null
                    ) {
                        lastBatteryUse.consumedMah?.let {
                            stringResource(R.string.settings_last_run_mah, TelemetryFormatters.decimal(it, 2))
                        } ?: stringResource(R.string.settings_last_run_insufficient_data)
                    } else {
                        stringResource(R.string.settings_off_tap_to_start)
                    },
            )
        }

        if (BuildConfig.DEBUG) {
            item {
                SettingsToggleChip(
                    checked = externalSensorSimulationEnabled,
                    onCheckedChanged = { enabled ->
                        ExternalSensorSimulation.setEnabled(enabled)
                        if (!enabled) {
                            if (recordingExternalHeartRateAddress == ExternalSensorSimulation.HEART_RATE_ADDRESS) {
                                viewModel.setRecordingExternalHeartRateDevice(null, null)
                            }
                            if (recordingExternalRunPodAddress == ExternalSensorSimulation.RUN_POD_ADDRESS) {
                                viewModel.setRecordingExternalRunPodDevice(null, null)
                            }
                        }
                        DebugTelemetry.log(
                            "ExternalSensors",
                            "event=simulation_toggle enabled=$enabled",
                        )
                    },
                    label = stringResource(R.string.settings_simulated_ble_sensors),
                    secondaryLabel =
                        if (externalSensorSimulationEnabled) {
                            stringResource(R.string.settings_hr_strap_and_run_pod_available)
                        } else {
                            stringResource(R.string.settings_debug_testing_only)
                        },
                )
            }
        }

        item {
            DiagnosticsSettingsSectionTitle()
        }
        item {
            SettingsOptionPickerRow(
                label = stringResource(R.string.settings_capture_mode),
                selectedValue = diagnosticsCaptureMode,
                options =
                    listOf(
                        SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_FULL to
                            stringResource(R.string.settings_full_diagnostics),
                        SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_BATTERY to
                            stringResource(R.string.settings_battery_benchmark),
                    ),
                secondaryLabel =
                    if (diagnosticsCaptureMode == SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_BATTERY) {
                        stringResource(R.string.settings_energy_only_low_overhead)
                    } else {
                        stringResource(R.string.settings_system_gps_and_recording_logs)
                    },
                onSelect = { mode ->
                    if (gpsDebugTelemetry) {
                        CompassHeadingReferenceDiagnostics.stop()
                        CompassDeepTraceDiagnostics.stop(reason = "capture_mode_change")
                        EnergyDiagnostics.recordSample(
                            context = context,
                            reason = "capture_toggle_off",
                            detail = "source=capture_mode_change",
                        )
                        energySummaryRevision += 1L
                        viewModel.setGpsDebugTelemetry(false)
                    }
                    viewModel.setDiagnosticsCaptureMode(mode)
                },
            )
        }
        item {
            val fullDiagnostics =
                diagnosticsCaptureMode == SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_FULL
            SettingsToggleChip(
                checked = fullDiagnostics && gpsDebugTelemetryPopupEnabled,
                enabled = fullDiagnostics,
                onCheckedChanged = {
                    if (!fullDiagnostics) return@SettingsToggleChip
                    viewModel.setGpsDebugTelemetryPopupEnabled(it)
                },
                label = stringResource(R.string.settings_debug_popup),
                secondaryLabel =
                    when {
                        !fullDiagnostics -> stringResource(R.string.settings_disabled_in_battery_benchmark)
                        gpsDebugTelemetryPopupEnabled -> stringResource(R.string.settings_on_during_full_diagnostics)
                        else -> stringResource(R.string.settings_off_during_full_diagnostics)
                    },
            )
        }
        item {
            val batteryBenchmark =
                diagnosticsCaptureMode == SettingsRepository.DIAGNOSTICS_CAPTURE_MODE_BATTERY
            SettingsToggleChip(
                checked = compassDeepTraceState.active,
                onCheckedChanged = { enabled ->
                    if (enabled) {
                        CompassDeepTraceDiagnostics.start(
                            context = context,
                            batteryBenchmarkSelected = batteryBenchmark,
                        )
                    } else {
                        CompassHeadingReferenceDiagnostics.stop()
                        CompassDeepTraceDiagnostics.stop(reason = "manual")
                    }
                },
                label = stringResource(R.string.settings_compass_deep_trace),
                secondaryLabel =
                    when {
                        compassDeepTraceState.active && batteryBenchmark ->
                            stringResource(R.string.settings_active_battery_benchmark_invalid)
                        compassDeepTraceState.active ->
                            stringResource(R.string.settings_active_stop_manually_when_finished)
                        batteryBenchmark && !batteryBenchmarkValidity.valid ->
                            stringResource(R.string.settings_start_compass_trace_invalidates_benchmark)
                        batteryBenchmark ->
                            stringResource(R.string.settings_manual_stop_invalidates_benchmark)
                        else -> stringResource(R.string.settings_compass_only_capture_manual_stop)
                    },
            )
        }
        item {
            Chip(
                modifier = Modifier.fillMaxWidth(),
                enabled =
                    compassDeepTraceState.active &&
                        !compassHeadingReferenceTestActive,
                label = {
                    WearText(
                        text =
                            stringResource(
                                R.string.settings_reference_north,
                                resources.getString(
                                    when (compassHeadingReferenceBasis) {
                                        CompassHeadingReferenceBasis.MAGNETIC_NORTH -> R.string.settings_magnetic_north
                                        CompassHeadingReferenceBasis.TRUE_NORTH -> R.string.settings_true_north
                                        else -> R.string.map_unknown
                                    },
                                ),
                            ),
                        modifier = Modifier.fillMaxWidth().basicMarquee(),
                        textAlign = TextAlign.Start,
                        overflow = TextOverflow.Visible,
                        maxLines = 1,
                    )
                },
                secondaryLabel = {
                    WearText(
                        text =
                            when (compassHeadingReferenceBasis) {
                                CompassHeadingReferenceBasis.MAGNETIC_NORTH ->
                                    stringResource(R.string.settings_use_for_a_physical_handheld_compass)
                                CompassHeadingReferenceBasis.TRUE_NORTH ->
                                    stringResource(R.string.settings_use_for_a_declination_adjusted_reference)
                                CompassHeadingReferenceBasis.UNKNOWN ->
                                    stringResource(R.string.settings_select_before_starting_the_test)
                            },
                        modifier = Modifier.basicMarquee(),
                        overflow = TextOverflow.Visible,
                        maxLines = 1,
                    )
                },
                onClick = {
                    CompassHeadingReferenceDiagnostics.selectReferenceBasis(
                        compassHeadingReferenceBasis.next(),
                    )
                },
            )
        }
        item {
            Chip(
                modifier = Modifier.fillMaxWidth(),
                enabled = compassDeepTraceState.active,
                label = {
                    WearText(
                        text =
                            if (compassHeadingReferenceTestActive) {
                                stringResource(R.string.settings_stop_heading_reference_test)
                            } else {
                                stringResource(R.string.settings_start_heading_reference_test)
                            },
                        modifier = Modifier.fillMaxWidth().basicMarquee(),
                        textAlign = TextAlign.Start,
                        overflow = TextOverflow.Visible,
                        maxLines = 1,
                    )
                },
                secondaryLabel = {
                    WearText(
                        text =
                            if (compassHeadingReferenceTestActive) {
                                stringResource(R.string.settings_open_navigate_shortcuts_to_mark_n_e_s_and_w)
                            } else {
                                stringResource(R.string.settings_deep_trace_active_measures_absolute_heading_error)
                            },
                        modifier = Modifier.basicMarquee(),
                        overflow = TextOverflow.Visible,
                        maxLines = 1,
                    )
                },
                onClick = { CompassHeadingReferenceDiagnostics.toggle() },
            )
        }

        if (BuildConfig.DEBUG) {
            item {
                Chip(
                    modifier = Modifier.fillMaxWidth(),
                    label = {
                        WearText(
                            text = stringResource(R.string.settings_force_close_app),
                            modifier = Modifier.fillMaxWidth().basicMarquee(),
                            textAlign = TextAlign.Start,
                            overflow = TextOverflow.Visible,
                            maxLines = 1,
                        )
                    },
                    secondaryLabel = {
                        WearText(
                            text = stringResource(R.string.settings_debug_crash_test),
                            modifier = Modifier.basicMarquee(),
                            overflow = TextOverflow.Visible,
                            maxLines = 1,
                        )
                    },
                    onClick = {
                        DebugTelemetry.log("DiagnosticsFlow", "manual_force_close_requested")
                        error("Manual force close from debugging settings")
                    },
                )
            }
        }
    }
}
