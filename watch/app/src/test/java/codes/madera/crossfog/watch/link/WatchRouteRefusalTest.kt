package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.ActivityOffer
import codes.madera.crossfog.link.ActivityOutbox
import codes.madera.crossfog.link.ByteStream
import codes.madera.crossfog.link.Clock
import codes.madera.crossfog.link.CloseReason
import codes.madera.crossfog.link.Framing
import codes.madera.crossfog.link.Hello
import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemRefused
import codes.madera.crossfog.link.LinkEvents
import codes.madera.crossfog.link.Message
import codes.madera.crossfog.link.Messages
import codes.madera.crossfog.link.RefusalReason
import codes.madera.crossfog.link.RouteOffer
import codes.madera.crossfog.link.WatchEndpoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream

/** A real `WatchRoutes` inside a real `WatchEndpoint`: the refusal has to reach the wire as `itemRefused`, not as a closed session. */
class WatchRouteRefusalTest {
    private class Out : ByteStream {
        val bytes = ByteArrayOutputStream()

        override fun write(bytes: ByteArray) = this.bytes.write(bytes)

        override fun close() = Unit

        fun messages(): List<Message> {
            val input = bytes.toByteArray().inputStream()
            val all = mutableListOf<Message>()
            while (true) all += Messages.parse(Framing.readFrame(input) ?: break)
            bytes.reset()
            return all
        }
    }

    private class Events : LinkEvents {
        val closed = mutableListOf<CloseReason>()

        override fun ready() = Unit

        override fun closed(
            reason: CloseReason,
            itemId: String?,
        ) {
            closed += reason
        }
    }

    private val zero =
        object : Clock {
            override fun nowMillis() = 0L
        }

    private val noWalks =
        object : ActivityOutbox {
            override fun next(): ActivityOffer? = null

            override fun delete(activityId: String) = Unit
        }

    private fun feed(
        endpoint: WatchEndpoint,
        vararg messages: Message,
    ) {
        for (m in messages) {
            val bytes = Framing.encode(Messages.encode(m))
            endpoint.onBytes(bytes, 0, bytes.size)
        }
    }

    @Test
    fun aRouteTheWatchCannotReadReachesThePhoneAsAnItemRefusedAndTheSessionStaysOpen() {
        val written = mutableListOf<String>()
        val routes = WatchRoutes(MemoryIndex(), { name, _ -> written += name; "" }, { false }, { false })
        val out = Out()
        val events = Events()
        val endpoint = WatchEndpoint(out, zero, routes, noWalks, events)
        endpoint.open()
        feed(endpoint, Hello(listOf(1)))
        out.messages()
        val offer = RouteOffer(ID_A, "Route", "2026-03-01T09:30:00Z", "<gpx>x</gpx>")
        feed(endpoint, offer)
        assertEquals(listOf<Message>(ItemRefused(ItemKind.ROUTE, ID_A, RefusalReason.UNREADABLE)), out.messages())
        assertTrue(events.closed.isEmpty())
        assertTrue(written.isEmpty())
    }
}
