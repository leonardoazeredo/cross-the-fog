package codes.madera.crossfog.platform

import codes.madera.crossfog.link.ActivityOffer
import codes.madera.crossfog.link.Items
import codes.madera.crossfog.link.ProtocolException
import codes.madera.crossfog.link.RouteOffer

/** A frame was malformed. The message never holds input, because it can reach JS and the crash log. */
class FrameException(message: String) : Exception(message)

/** The offers a staged or queued file holds, read by `link/`'s parser: the only parsing this module does. */
object Frames {
  fun parseActivityOffer(bytes: ByteArray): ActivityOffer = refusing { Items.activityOffer(bytes) }

  fun parseRouteOffer(bytes: ByteArray): RouteOffer = refusing { Items.routeOffer(bytes) }

  // ProtocolException messages are fixed text or a field name, so they may reach JS and the log.
  private fun <T> refusing(read: () -> T): T = try {
    read()
  } catch (e: ProtocolException) {
    throw FrameException(e.message ?: "invalid frame")
  }
}

/** What `pendingActivities` lists: the file stays behind `readActivity`. */
internal fun ActivityOffer.summary(): Map<String, Any?> = buildMap {
  put("activityId", activityId)
  if (routeId != null) put("routeId", routeId)
  put("encoderVersion", encoderVersion)
}
