package codes.madera.crossfog.watch.core.service.diagnostics

import codes.madera.crossfog.watch.domain.sensors.CompassHeadingProvenance
import codes.madera.crossfog.watch.domain.sensors.CompassMagneticQuality
import codes.madera.crossfog.watch.domain.sensors.CompassNorthBasis
import codes.madera.crossfog.watch.domain.sensors.CompassProviderType
import codes.madera.crossfog.watch.domain.sensors.CompassRelativeMotionSample
import codes.madera.crossfog.watch.domain.sensors.CompassTrackingReason
import codes.madera.crossfog.watch.domain.sensors.CompassTrackingState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CompassDeepTraceAggregationTest {
    @Test
    fun automaticIntegrityIncidentSurvivesLiveRingRolloverAndExportsItsTrigger() {
        val ring = CompassDeepTraceEventRing(capacity = 2)
        ring.record(CompassDeepTraceEvent.Telemetry(1_000L, "before"))
        ring.record(integrityDecision(atElapsedMs = 1_001L))
        repeat(5) { index ->
            ring.record(CompassDeepTraceEvent.Telemetry(1_002L + index, "after_$index"))
        }

        val incident = requireNotNull(ring.incidentSnapshot(nowElapsedMs = 3_001L))
        val marker = incident.markerAndPostEvents.first().event as CompassDeepTraceEvent.Marker

        assertEquals("automatic_integrity_incident", marker.type)
        assertEquals("before", (incident.preMarkerEvents.single().event as CompassDeepTraceEvent.Telemetry).line)
        assertTrue(incident.markerAndPostEvents.any { it.event is CompassDeepTraceEvent.IntegrityDecision })
        assertTrue(incident.postTailComplete)
        assertEquals(2, ring.snapshot().size)
    }

    @Test
    fun quarantineAlsoAutomaticallyPreservesAnIncident() {
        val ring = CompassDeepTraceEventRing(capacity = 2)
        ring.record(integrityDecision(1_000L, quarantineActive = true, unresolvedIndependentDisagreement = false))

        assertTrue(requireNotNull(ring.incidentSnapshot(3_000L)).postTailComplete)
    }

    @Test
    fun weakConfidenceAloneDoesNotAutomaticallyPreserveAnIncident() {
        val ring = CompassDeepTraceEventRing(capacity = 2)
        ring.record(integrityDecision(1_000L, unresolvedIndependentDisagreement = false))

        assertNull(ring.incidentSnapshot(3_000L))
    }

    @Test
    fun manualReportReplacesAutomaticIncidentAndKeepsTheFirstManualReport() {
        val ring = CompassDeepTraceEventRing(capacity = 2)
        ring.record(integrityDecision(1_000L))
        ring.incidentSnapshot(3_000L)
        ring.record(CompassDeepTraceEvent.Marker(4_000L, "heading_looks_wrong", "manual_one"))
        ring.record(CompassDeepTraceEvent.Marker(4_100L, "heading_looks_wrong", "manual_two"))
        ring.record(integrityDecision(4_200L))

        val incident = requireNotNull(ring.incidentSnapshot(6_000L))
        val marker = incident.markerAndPostEvents.first().event as CompassDeepTraceEvent.Marker

        assertEquals("heading_looks_wrong", marker.type)
        assertEquals("manual_one", marker.detail)
        assertFalse(
            incident.markerAndPostEvents.any {
                (it.event as? CompassDeepTraceEvent.Marker)?.type == "automatic_integrity_incident"
            },
        )
    }

    @Test
    fun manualReportReplacesAutomaticCaptureWhileItsTailIsStillRunning() {
        val ring = CompassDeepTraceEventRing(capacity = 2)
        ring.record(integrityDecision(1_000L))
        ring.record(CompassDeepTraceEvent.Marker(1_100L, "heading_looks_wrong", "manual"))

        val incident = requireNotNull(ring.incidentSnapshot(3_100L))
        val marker = incident.markerAndPostEvents.first().event as CompassDeepTraceEvent.Marker

        assertEquals("heading_looks_wrong", marker.type)
        assertEquals(1_100L, marker.atElapsedMs)
    }

    @Test
    fun automaticIncidentPostTailStaysBoundedDuringHighRateDelivery() {
        val ring = CompassDeepTraceEventRing(capacity = 2)
        ring.record(integrityDecision(1_000L))
        repeat(600) { index ->
            ring.record(CompassDeepTraceEvent.Telemetry(1_001L + index, "sample_$index"))
        }

        val incident = requireNotNull(ring.incidentSnapshot(3_000L))

        assertEquals(512, incident.markerAndPostEvents.size)
        assertEquals(90, incident.droppedPostEvents)
        assertEquals(2, ring.snapshot().size)
    }

    @Test
    fun stoppingBeforeTheDeadlineKeepsAPartialIncidentAndClearResetsIt() {
        val ring = CompassDeepTraceEventRing(capacity = 2)
        ring.record(integrityDecision(1_000L))
        ring.freezeIncident(1_100L)

        assertFalse(requireNotNull(ring.incidentSnapshot(1_100L)).postTailComplete)
        ring.clear()
        assertNull(ring.incidentSnapshot(3_000L))
        assertEquals(0, ring.droppedEvents)
        ring.record(integrityDecision(4_000L))
        assertTrue(requireNotNull(ring.incidentSnapshot(6_000L)).postTailComplete)
    }

    private fun integrityDecision(
        atElapsedMs: Long,
        quarantineActive: Boolean = false,
        unresolvedIndependentDisagreement: Boolean = true,
    ) = CompassDeepTraceEvent.IntegrityDecision(
        atElapsedMs = atElapsedMs,
        provider = "google_fused",
        sourceSampleId = 7L,
        headingDeg = 180f,
        liveHeadingErrorDeg = 25f,
        conservativeHeadingErrorDeg = 180f,
        trackingState = CompassTrackingState.TRACKING,
        trackingReason = CompassTrackingReason.STABLE,
        relativeHeadingDeg = 0f,
        fusedRelativeDisagreementDeg = 180f,
        targetHeadingDeg = 180f,
        trusted = false,
        quarantineActive = quarantineActive,
        recoveryActive = false,
        relativeWitnessAvailable = true,
        relativeWitnessSuppressed = unresolvedIndependentDisagreement,
        unresolvedIndependentDisagreement = unresolvedIndependentDisagreement,
        heldOutput = quarantineActive,
        provenance = null,
    )

    @Test
    fun aggregatesWraparoundReversalsRawSensorsAndRenderLag() {
        val accumulator = CompassDeepTraceWindowAccumulator(startedAtElapsedMs = 1_000L)
        accumulator.recordProvider(providerSample(headingDeg = 350f, atElapsedMs = 1_000L))
        accumulator.recordProvider(providerSample(headingDeg = 5f, atElapsedMs = 1_100L))
        accumulator.recordProvider(providerSample(headingDeg = 355f, atElapsedMs = 1_200L))
        accumulator.recordRawSensor(
            sensor = CompassDeepTraceRawSensor.GYROSCOPE,
            x = 3f,
            y = 4f,
            z = -2f,
        )
        accumulator.recordRawSensor(
            sensor = CompassDeepTraceRawSensor.ACCELEROMETER,
            x = 0f,
            y = 0f,
            z = 9.8f,
        )
        accumulator.recordRawSensor(
            sensor = CompassDeepTraceRawSensor.MAGNETOMETER,
            x = 30f,
            y = 40f,
            z = 0f,
        )
        accumulator.recordRender(renderSample(target = 10f, rendered = 5f, mapRotation = -5f, atElapsedMs = 1_100L))
        accumulator.recordRender(renderSample(target = 20f, rendered = 15f, mapRotation = -15f, atElapsedMs = 1_200L))

        val line = accumulator.toTelemetryLine(index = 1, endedAtElapsedMs = 6_000L)

        assertTrue(line.contains("providerSamples=3"))
        assertTrue(line.contains("fusedStepAvgDeg=12.5"))
        assertTrue(line.contains("fusedReversals=1"))
        assertTrue(line.contains("accuracyHigh=3"))
        assertTrue(line.contains("gyroSamples=1"))
        assertTrue(line.contains("accelSamples=1"))
        assertTrue(line.contains("magSamples=1"))
        assertTrue(line.contains("magMagnitudeMinUt=50.0"))
        assertTrue(line.contains("fusedLiveErrorAvgDeg=6.0"))
        assertTrue(line.contains("fusedConservativeErrorAvgDeg=18.0"))
        assertTrue(line.contains("trackingSamples=3"))
        assertTrue(line.contains("lastNorthBasis=google_automatic"))
        assertTrue(line.contains("disagreementMaxDeg=4.0"))
        assertTrue(line.contains("renderSamples=2"))
        assertTrue(line.contains("targetRenderDeltaAvgDeg=5.0"))
    }

    @Test
    fun relativeMotionAndConeChangesKeepTheirOwnIdentityInRenderExports() {
        val provenance = CompassHeadingProvenance(CompassProviderType.GOOGLE_FUSED, 5L)
        val motion = CompassRelativeMotionSample(20f, 0.9f, 1_002L, provenance, displayRotation = 1)
        val render =
            CompassDeepTraceEvent.Render(
                atElapsedMs = 1_003L,
                sourceSampleId = 7L,
                targetHeadingDeg = 120f,
                renderedHeadingDeg = 110f,
                mapRotationDeg = -110f,
                provenance = provenance,
            )
        val ring = CompassDeepTraceEventRing(capacity = 8)
        ring.record(render)
        val coasting = render.copy(atElapsedMs = 1_004L, relativeMotionSample = motion)
        ring.record(coasting)
        ring.record(coasting.copy(atElapsedMs = 1_005L))
        val concealed = coasting.copy(atElapsedMs = 1_006L, coneSuppressed = true)
        ring.record(concealed)
        ring.record(concealed.copy(atElapsedMs = 1_007L, relativeMotionSample = motion.copy(atElapsedMs = 1_006L)))

        assertEquals(4, ring.snapshot().size)
    }

    @Test
    fun decisionEventRingIsBoundedOrderedAndCoalescesIdenticalRenderRecords() {
        val ring = CompassDeepTraceEventRing(capacity = 2)
        val render =
            CompassDeepTraceEvent.Render(
                atElapsedMs = 1_001L,
                sourceSampleId = 4L,
                targetHeadingDeg = 10f,
                renderedHeadingDeg = 9f,
                mapRotationDeg = -9f,
                provenance = null,
            )

        ring.record(CompassDeepTraceEvent.Telemetry(atElapsedMs = 1_000L, line = "start"))
        ring.record(render)
        ring.record(render.copy(atElapsedMs = 1_002L))
        ring.record(CompassDeepTraceEvent.Marker(atElapsedMs = 1_003L, type = "wrong", detail = "manual"))

        val records = ring.snapshot()

        assertEquals(listOf(2L, 3L), records.map { it.eventId })
        assertTrue(records[0].event is CompassDeepTraceEvent.Render)
        assertTrue(records[1].event is CompassDeepTraceEvent.Marker)
        assertEquals(1, ring.droppedEvents)
    }

    @Test
    fun preservedIncidentKeepsPreMarkerHistoryAndBoundedPostTailAfterLiveRingRotates() {
        val ring = CompassDeepTraceEventRing(capacity = 2)
        ring.record(CompassDeepTraceEvent.Telemetry(atElapsedMs = 1_000L, line = "before_one"))
        ring.record(CompassDeepTraceEvent.Telemetry(atElapsedMs = 1_001L, line = "before_two"))
        ring.record(CompassDeepTraceEvent.Telemetry(atElapsedMs = 1_002L, line = "before_three"))
        val capture =
            CompassDeepTraceIncidentCapture(
                preMarkerEvents = ring.snapshot(),
                preMarkerLiveRingDroppedEvents = ring.droppedEvents,
                postTailEndsAtElapsedMs = 3_000L,
                postEventCapacity = 2,
            )

        val marker =
            requireNotNull(
                ring.record(
                    CompassDeepTraceEvent.Marker(
                        atElapsedMs = 1_003L,
                        type = "heading_looks_wrong",
                        detail = "manual",
                    ),
                ),
            )
        capture.record(marker)
        val post = requireNotNull(ring.record(CompassDeepTraceEvent.Telemetry(1_004L, "after")))
        capture.record(post)
        capture.record(requireNotNull(ring.record(CompassDeepTraceEvent.Telemetry(1_005L, "dropped"))))

        repeat(4) { index ->
            ring.record(CompassDeepTraceEvent.Telemetry(2_000L + index, "live_$index"))
        }

        assertFalse(
            capture.record(
                requireNotNull(ring.record(CompassDeepTraceEvent.Telemetry(3_001L, "too_late"))),
            ),
        )
        val incident = capture.snapshot(postTailComplete = true)

        assertEquals(listOf(2L, 3L), incident.preMarkerEvents.map { it.eventId })
        assertEquals(listOf(4L, 5L), incident.markerAndPostEvents.map { it.eventId })
        assertEquals(1, incident.preMarkerLiveRingDroppedEvents)
        assertEquals(1, incident.droppedPostEvents)
        assertTrue(incident.postTailComplete)
    }

    @Test
    fun fusedAndFallbackHeadingsAreAggregatedIndependently() {
        val accumulator = CompassDeepTraceWindowAccumulator(startedAtElapsedMs = 1_000L)
        accumulator.recordProvider(providerSample(headingDeg = 0f, atElapsedMs = 1_000L))
        accumulator.recordProvider(
            providerSample(headingDeg = 180f, atElapsedMs = 1_010L).copy(provider = "sensor_manager"),
        )
        accumulator.recordProvider(providerSample(headingDeg = 10f, atElapsedMs = 1_100L))
        accumulator.recordProvider(
            providerSample(headingDeg = 190f, atElapsedMs = 1_110L).copy(provider = "sensor_manager"),
        )

        val line = accumulator.toTelemetryLine(index = 1, endedAtElapsedMs = 2_000L)

        assertTrue(line.contains("fusedStepMaxDeg=10.0"))
        assertTrue(line.contains("sensorManagerStepMaxDeg=10.0"))
    }

    @Test
    fun aggregatesAnActiveNonControllingWitnessAndUnresolvedDisagreement() {
        val accumulator = CompassDeepTraceWindowAccumulator(startedAtElapsedMs = 1_000L)
        accumulator.recordProvider(
            providerSample(headingDeg = 180f, atElapsedMs = 1_000L).copy(
                relativeWitnessAvailable = true,
                relativeWitnessSuppressed = true,
                unresolvedIndependentDisagreement = true,
            ),
        )

        val line = accumulator.toTelemetryLine(index = 1, endedAtElapsedMs = 2_000L)

        assertTrue(line.contains("relativeSamples=1"))
        assertTrue(line.contains("relativeWitnessAvailableSamples=1"))
        assertTrue(line.contains("relativeWitnessSuppressedSamples=1"))
        assertTrue(line.contains("unresolvedIndependentDisagreementSamples=1"))
    }

    private fun providerSample(
        headingDeg: Float,
        atElapsedMs: Long,
    ) = CompassDeepTraceProviderSample(
        provider = "google_fused",
        headingDeg = headingDeg,
        headingErrorDeg = 8f,
        liveHeadingErrorDeg = 6f,
        conservativeHeadingErrorDeg = 18f,
        accuracy = 3,
        startupWarmup = false,
        usable = true,
        trackingState = CompassTrackingState.TRACKING,
        trackingReason = CompassTrackingReason.STABLE,
        northBasis = CompassNorthBasis.GOOGLE_AUTOMATIC,
        magneticQuality = CompassMagneticQuality.GOOD,
        magneticFieldUt = 50f,
        relativeHeadingDeg = headingDeg - 2f,
        fusedRelativeDisagreementDeg = 4f,
        targetHeadingDeg = headingDeg,
        atElapsedMs = atElapsedMs,
    )

    private fun renderSample(
        target: Float,
        rendered: Float,
        mapRotation: Float,
        atElapsedMs: Long,
    ) = CompassDeepTraceRenderSample(
        targetHeadingDeg = target,
        renderedHeadingDeg = rendered,
        mapRotationDeg = mapRotation,
        continuityActive = false,
        continuityOffsetDeg = 0f,
        atElapsedMs = atElapsedMs,
    )
}
