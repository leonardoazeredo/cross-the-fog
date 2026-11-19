package codes.madera.crossfog.watch.core.service.location.service

import codes.madera.crossfog.watch.core.service.location.adapters.WatchGpsAvailabilityReason
import codes.madera.crossfog.watch.core.service.location.model.GpsEnvironmentWarning
import codes.madera.crossfog.watch.core.service.location.policy.LocationSourceMode
import org.junit.Assert.assertEquals
import org.junit.Test

class LocationEnvironmentResolverPhoneUnknownTest {
    // A failover keeps the resolver on watch GPS while the phone's state is still unknown, which must not warn.
    @Test
    fun watchGpsWithAnUnknownPhoneAndNoWatchOnlyRequestHasNoWarning() {
        val decision =
            resolveLocationEnvironmentDecision(
                sourceMode = LocationSourceMode.WATCH_GPS,
                watchOnlyRequested = false,
                watchGpsAvailability = WatchGpsAvailabilityReason.AVAILABLE,
                phoneConnected = null,
                locationSettings = null,
            )

        assertEquals(GpsEnvironmentWarning.NONE, decision.warning)
        assertEquals(LocationEnvironmentAction.CONTINUE, decision.action)
    }

    @Test
    fun watchGpsWithADisconnectedPhoneAndNoWatchOnlyRequestStillWarns() {
        val decision =
            resolveLocationEnvironmentDecision(
                sourceMode = LocationSourceMode.WATCH_GPS,
                watchOnlyRequested = false,
                watchGpsAvailability = WatchGpsAvailabilityReason.AVAILABLE,
                phoneConnected = false,
                locationSettings = null,
            )

        assertEquals(GpsEnvironmentWarning.AUTO_PHONE_DISCONNECTED_USING_WATCH_GPS, decision.warning)
    }
}
