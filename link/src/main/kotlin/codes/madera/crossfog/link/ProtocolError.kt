package codes.madera.crossfog.link

/**
 * Why bytes from the other end were refused. Every kind has a fixed message: the input never reaches
 * one, because a message can end up in a log or in JS, and the input is a track or a person's name.
 */
enum class ProtocolError(val text: String) {
  FRAME_TOO_LARGE("frame is too large"),
  FRAME_EMPTY("frame is empty"),
  FRAME_TRUNCATED("frame is truncated"),
  FRAME_TRAILING_BYTES("bytes follow the frame"),
  NOT_A_JSON_OBJECT("frame is not a JSON object"),
  NESTED_TOO_DEEPLY("frame is nested too deeply"),
  FIELD_MISSING_OR_INVALID("a field is missing or invalid"),
  UNKNOWN_TYPE("message type is not known"),
  UNSUPPORTED_VERSION("protocol version is not supported"),
  NO_COMMON_VERSION("no protocol version in common"),
  REVISION_MISMATCH("revision does not match the route"),
}

/** Thrown for any bytes this module refuses; [message] is the fixed text of [error] or names a field. */
class ProtocolException(val error: ProtocolError, message: String = error.text) : Exception(message)
