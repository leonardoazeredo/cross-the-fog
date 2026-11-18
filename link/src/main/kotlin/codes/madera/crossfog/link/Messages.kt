package codes.madera.crossfog.link

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

/**
 * The messages of the link, version 1. On the wire each is a JSON object `{"v":1,"type":...}` in
 * one frame (see [Framing]); a value of this type holds only fields that passed their bounds, so
 * there is no partial or unchecked message to hand on. `toString` of anything that carries a track
 * or a name names the type alone: a generated one would print it into a log.
 */
sealed interface Message

/** `v` 1 always; `versions`: 1 to 16 distinct integers, each 1 to 65535. */
data class Hello(val versions: List<Int>) : Message {
  init {
    if (versions.size !in 1..MAX_VERSIONS || versions.toSet().size != versions.size || versions.any { it !in 1..MAX_VERSION }) {
      throw Fields.invalid("versions")
    }
  }

  companion object {
    const val MAX_VERSIONS = 16
    const val MAX_VERSION = 65535
  }
}

/** `{"type":"ping"}`: no fields. */
object Ping : Message {
  override fun toString() = "Ping"
}

/**
 * `routeId` UUID; `name` 1 to 255 characters; `createdAt` 1 to 64; `gpx` 1 to [Framing.MAX_FRAME_BYTES]
 * characters; `revision` is derived from `gpx` ([Revision]) and written on the wire, where a value
 * that is not the hash of the `gpx` beside it is refused.
 */
data class RouteOffer(val routeId: String, val name: String, val createdAt: String, val gpx: String) : Message {
  init {
    Fields.uuid(routeId, "routeId")
    Fields.text(name, "name", 255)
    Fields.text(createdAt, "createdAt", 64)
    Fields.text(gpx, "gpx", Framing.MAX_FRAME_BYTES)
  }

  val revision: String get() = Revision.of(gpx)

  override fun toString() = "RouteOffer"
}

/** The watch has stored the route: `routeId` UUID, `revision` the one of the offer it answers. */
data class RouteSaved(val routeId: String, val revision: String) : Message {
  init {
    Fields.uuid(routeId, "routeId")
    Fields.revision(revision, "revision")
  }

  override fun toString() = "RouteSaved"
}

/** `activityId` UUID; `routeId` UUID or absent; `encoderVersion` 1 to 64 characters; `gpx` 1 to [Framing.MAX_FRAME_BYTES]. */
data class ActivityOffer(val activityId: String, val routeId: String?, val encoderVersion: String, val gpx: String) : Message {
  init {
    Fields.uuid(activityId, "activityId")
    if (routeId != null) Fields.uuid(routeId, "routeId")
    Fields.text(encoderVersion, "encoderVersion", 64)
    Fields.text(gpx, "gpx", Framing.MAX_FRAME_BYTES)
  }

  override fun toString() = "ActivityOffer"
}

/** The phone has stored the activity and the watch may delete it: `activityId` UUID. */
data class ActivityStored(val activityId: String) : Message {
  init {
    Fields.uuid(activityId, "activityId")
  }

  override fun toString() = "ActivityStored"
}

object Messages {
  /**
   * The message in one frame's body. Checks the version before the type and the type before any
   * other field, so a later version or an unknown type is refused by name and its fields are never
   * read. Fields this version does not name are ignored.
   */
  fun parse(bytes: ByteArray): Message {
    val o = parseObject(bytes)
    if (Fields.integer(o.opt("v"), "v") != Protocol.VERSION.toLong()) {
      throw ProtocolException(ProtocolError.UNSUPPORTED_VERSION)
    }
    return when (Fields.text(o.opt("type"), "type", 32)) {
      "hello" -> Hello(versions(o.opt("versions")))
      "ping" -> Ping
      "routeOffer" -> routeOffer(o, requireRevision = true)
      "routeSaved" -> RouteSaved(Fields.uuid(o.opt("routeId"), "routeId"), Fields.revision(o.opt("revision"), "revision"))
      "activityOffer" -> activityOffer(o)
      "activityStored" -> ActivityStored(Fields.uuid(o.opt("activityId"), "activityId"))
      else -> throw ProtocolException(ProtocolError.UNKNOWN_TYPE)
    }
  }

  /** The body of one frame, fields in a fixed order. */
  fun encode(message: Message): ByteArray {
    val head = """{"v":${Protocol.VERSION},"type":"""
    val text = when (message) {
      is Hello -> """$head"hello","versions":[${message.versions.joinToString(",")}]}"""
      is Ping -> """$head"ping"}"""
      is RouteOffer ->
        """$head"routeOffer","routeId":"${message.routeId}","name":${q(message.name)},"createdAt":${q(message.createdAt)},""" +
          """"revision":"${message.revision}","gpx":${q(message.gpx)}}"""
      is RouteSaved -> """$head"routeSaved","routeId":"${message.routeId}","revision":"${message.revision}"}"""
      is ActivityOffer ->
        """$head"activityOffer","activityId":"${message.activityId}",""" +
          (if (message.routeId != null) """"routeId":"${message.routeId}",""" else "") +
          """"encoderVersion":${q(message.encoderVersion)},"gpx":${q(message.gpx)}}"""
      is ActivityStored -> """$head"activityStored","activityId":"${message.activityId}"}"""
    }
    return text.toByteArray(Charsets.UTF_8)
  }

  // Written here, not JSONObject.quote: that one escapes more than JSON needs, and differently between
  // org.json builds, and the shared test vectors pin the exact bytes.
  private fun q(text: String): String {
    val out = StringBuilder(text.length + 2).append('"')
    for (c in text) {
      when {
        c == '"' -> out.append("\\\"")
        c == '\\' -> out.append("\\\\")
        c == '\n' -> out.append("\\n")
        c == '\r' -> out.append("\\r")
        c == '\t' -> out.append("\\t")
        c == '\b' -> out.append("\\b")
        c == '\u000c' -> out.append("\\f")
        c < ' ' -> out.append("\\u%04x".format(c.code))
        else -> out.append(c)
      }
    }
    return out.append('"').toString()
  }

  // What JSONTokener.nextClean returns at the end of its input.
  private const val END = '\u0000'

  private fun versions(value: Any?): List<Int> {
    val array = value as? JSONArray ?: throw Fields.invalid("versions")
    if (array.length() !in 1..Hello.MAX_VERSIONS) throw Fields.invalid("versions")
    return List(array.length()) { i ->
      val n = Fields.integer(array.opt(i), "versions")
      if (n !in 1..Hello.MAX_VERSION) throw Fields.invalid("versions")
      n.toInt()
    }
  }

  internal fun parseObject(bytes: ByteArray): JSONObject {
    if (bytes.size > Framing.MAX_FRAME_BYTES) throw ProtocolException(ProtocolError.FRAME_TOO_LARGE)
    // org.json puts the whole input into its syntax-error message, so the cause is dropped.
    return try {
      val tokener = JSONTokener(String(bytes, Charsets.UTF_8))
      val parsed = JSONObject(tokener)
      // org.json stops at the end of the first object and ignores whatever follows it.
      if (tokener.nextClean() != END) throw ProtocolException(ProtocolError.NOT_A_JSON_OBJECT)
      parsed
    } catch (e: JSONException) {
      throw ProtocolException(ProtocolError.NOT_A_JSON_OBJECT)
    } catch (e: StackOverflowError) {
      // org.json recurses, so a deeply nested frame must not take the process down.
      throw ProtocolException(ProtocolError.NESTED_TOO_DEEPLY)
    }
  }

  internal fun routeOffer(o: JSONObject, requireRevision: Boolean): RouteOffer {
    val offer = RouteOffer(
      routeId = Fields.uuid(o.opt("routeId"), "routeId"),
      name = Fields.text(o.opt("name"), "name", 255),
      createdAt = Fields.text(o.opt("createdAt"), "createdAt", 64),
      gpx = Fields.text(o.opt("gpx"), "gpx", Framing.MAX_FRAME_BYTES),
    )
    val given = o.opt("revision")
    if (Fields.isAbsent(given)) {
      if (requireRevision) throw Fields.invalid("revision")
    } else if (Fields.revision(given, "revision") != offer.revision) {
      throw ProtocolException(ProtocolError.REVISION_MISMATCH)
    }
    return offer
  }

  internal fun activityOffer(o: JSONObject) = ActivityOffer(
    activityId = Fields.uuid(o.opt("activityId"), "activityId"),
    routeId = Fields.optionalUuid(o.opt("routeId"), "routeId"),
    encoderVersion = Fields.text(o.opt("encoderVersion"), "encoderVersion", 64),
    gpx = Fields.text(o.opt("gpx"), "gpx", Framing.MAX_FRAME_BYTES),
  )
}
