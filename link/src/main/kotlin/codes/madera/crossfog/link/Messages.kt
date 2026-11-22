package codes.madera.crossfog.link

import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

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

/** Why the watch refused a pairing. The wire names are fixed and nothing else is ever sent as a reason. */
enum class PairRejection(val wire: String) {
  WRONG_CODE("wrong_code"),
  CODE_USED("code_used"),
  EXPIRED("expired"),
  TOO_MANY_TRIES("too_many_tries");

  companion object {
    fun of(wire: String): PairRejection? = entries.firstOrNull { it.wire == wire }
  }
}

/** Phone to watch, first message of a pairing session: `proof` is 64 lowercase hex (see [Pairing.proof]). */
data class PairRequest(val proof: String) : Message {
  init {
    Fields.revision(proof, "proof")
  }

  // The proof is derived from the one-time code, so it stays out of any log.
  override fun toString() = "PairRequest"
}

/** Watch to phone: the proof matched and the code is spent; the watch has stored nothing yet. */
object PairAccepted : Message {
  override fun toString() = "PairAccepted"
}

/** Watch to phone: the proof was refused, for one of the fixed reasons. */
data class PairRejected(val reason: PairRejection) : Message {
  override fun toString() = "PairRejected"
}

/** Phone to watch: the phone has the watch's key staged and the watch may store the phone's. */
object PairConfirm : Message {
  override fun toString() = "PairConfirm"
}

/** Watch to phone: the watch has stored the phone's key; the phone may store the watch's. */
object PairDone : Message {
  override fun toString() = "PairDone"
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

/**
 * The receiver will never take the item, for what it holds: `kind` is `route` or `activity`, `id` the UUID
 * of the offer, `reason` one of [RefusalReason]. The session stays open.
 */
data class ItemRefused(val kind: ItemKind, val id: String, val reason: RefusalReason) : Message {
  init {
    Fields.uuid(id, "id")
  }

  override fun toString() = "ItemRefused"
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
      "itemRefused" -> ItemRefused(
        kind = kindOf(Fields.text(o.opt("kind"), "kind", 32)),
        id = Fields.uuid(o.opt("id"), "id"),
        reason = RefusalReason.of(Fields.text(o.opt("reason"), "reason", 32)) ?: throw Fields.invalid("reason"),
      )
      "pairRequest" -> PairRequest(Fields.revision(o.opt("proof"), "proof"))
      "pairAccepted" -> PairAccepted
      "pairRejected" -> PairRejected(PairRejection.of(Fields.text(o.opt("reason"), "reason", 32)) ?: throw Fields.invalid("reason"))
      "pairConfirm" -> PairConfirm
      "pairDone" -> PairDone
      else -> throw ProtocolException(ProtocolError.UNKNOWN_TYPE)
    }
  }

  private val HEAD = """{"v":${Protocol.VERSION},"type":"""

  /**
   * The length of [encode]'s bytes, counted without building them: an offer's track can be 16 MiB,
   * and the string, builder and byte array that [encode] makes of it are several times that. The other
   * messages are small, so they are encoded; a test pins the two together for every kind.
   */
  fun encodedSize(message: Message): Long = when (message) {
    is RouteOffer ->
      HEAD.length + """"routeOffer","routeId":"""".length + message.routeId.length + "\",\"name\":".length + quotedSize(message.name) +
        ",\"createdAt\":".length + quotedSize(message.createdAt) + ",\"revision\":\"".length + Revision.HEX_LENGTH +
        "\",\"gpx\":".length + quotedSize(message.gpx) + "}".length.toLong()
    is ActivityOffer ->
      HEAD.length + """"activityOffer","activityId":"""".length + message.activityId.length + "\",".length +
        (if (message.routeId != null) """"routeId":"${message.routeId}",""".length else 0) +
        """"encoderVersion":""".length + quotedSize(message.encoderVersion) + ",\"gpx\":".length + quotedSize(message.gpx) + "}".length.toLong()
    else -> encode(message).size.toLong()
  }

  /** The bytes [q] writes for [text] once UTF-8 encoded: the quotes, an escape's two or six, and a character's own one to four. */
  private fun quotedSize(text: String): Long {
    var n = 2L
    var i = 0
    while (i < text.length) {
      val c = text[i]
      n += when {
        c == '"' || c == '\\' || c == '\n' || c == '\r' || c == '\t' || c == '\b' || c == '\u000c' -> 2
        c < ' ' -> 6
        c.code < 0x80 -> 1
        c.code < 0x800 -> 2
        // An unpaired surrogate cannot be in an offer (Fields.text refuses it), so a high one always has its low one.
        Character.isHighSurrogate(c) -> { i++; 4 }
        else -> 3
      }
      i++
    }
    return n
  }

  /** The body of one frame, fields in a fixed order. */
  fun encode(message: Message): ByteArray {
    val head = HEAD
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
      is ItemRefused -> """$head"itemRefused","kind":"${if (message.kind == ItemKind.ROUTE) "route" else "activity"}","id":"${message.id}","reason":"${message.reason.wire}"}"""
      is PairRequest -> """$head"pairRequest","proof":"${message.proof}"}"""
      is PairAccepted -> """$head"pairAccepted"}"""
      is PairRejected -> """$head"pairRejected","reason":"${message.reason.wire}"}"""
      is PairConfirm -> """$head"pairConfirm"}"""
      is PairDone -> """$head"pairDone"}"""
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

  private fun kindOf(wire: String): ItemKind = when (wire) {
    "route" -> ItemKind.ROUTE
    "activity" -> ItemKind.ACTIVITY
    else -> throw Fields.invalid("kind")
  }

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
    val text = utf8(bytes)
    StrictJson.requireObject(text)
    // Valid by now, so org.json only builds the object. Its own syntax error would quote the input.
    return try {
      JSONObject(text)
    } catch (e: JSONException) {
      throw ProtocolException(ProtocolError.NOT_A_JSON_OBJECT)
    }
  }

  /**
   * [bytes] as text. A lossy decode would turn a bad byte into U+FFFD and store the changed text under
   * the sender's id, so the bytes are checked first, through a small buffer that is thrown away as it
   * fills; the one decoded copy is then the string itself, made from bytes already known to be valid.
   */
  private fun utf8(bytes: ByteArray): String {
    val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    val input = ByteBuffer.wrap(bytes)
    val scratch = CharBuffer.allocate(CHECK_CHARS)
    try {
      while (true) {
        val result = decoder.decode(input, scratch, true)
        if (result.isUnderflow) break
        if (result.isError) result.throwException()
        scratch.clear()
      }
      scratch.clear()
      decoder.flush(scratch).let { if (it.isError) it.throwException() }
    } catch (e: CharacterCodingException) {
      throw ProtocolException(ProtocolError.NOT_A_JSON_OBJECT)
    }
    return String(bytes, Charsets.UTF_8)
  }

  private const val CHECK_CHARS = 8192

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
