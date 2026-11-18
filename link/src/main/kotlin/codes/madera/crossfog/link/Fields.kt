package codes.madera.crossfog.link

/**
 * Checks of one value read from untrusted bytes. Each takes the raw value and the field's fixed
 * name, and throws the same error for a missing, mistyped or out-of-bounds value, never one that
 * names what was received. A number is never read as text, nor text as a number.
 */
internal object Fields {
  fun text(value: Any?, key: String, maxLength: Int): String {
    val s = value as? String
    if (s.isNullOrEmpty() || s.length > maxLength || hasUnpairedSurrogate(s)) throw invalid(key)
    return s
  }

  /** UTF-8 cannot hold one, so it would be written as "?": the text that arrived would not be the text sent. */
  private fun hasUnpairedSurrogate(s: String): Boolean {
    var i = 0
    while (i < s.length) {
      val c = s[i]
      if (Character.isHighSurrogate(c)) {
        if (i + 1 >= s.length || !Character.isLowSurrogate(s[i + 1])) return true
        i++
      } else if (Character.isLowSurrogate(c)) {
        return true
      }
      i++
    }
    return false
  }

  fun uuid(value: Any?, key: String): String {
    val s = text(value, key, 36)
    if (!Ids.UUID.matches(s)) throw invalid(key)
    return s
  }

  fun optionalUuid(value: Any?, key: String): String? = if (isAbsent(value)) null else uuid(value, key)

  fun revision(value: Any?, key: String): String {
    val s = text(value, key, 64)
    if (!Revision.isWellFormed(s)) throw invalid(key)
    return s
  }

  fun integer(value: Any?, key: String): Long = when (value) {
    is Int -> value.toLong()
    is Long -> value
    else -> throw invalid(key)
  }

  /** JSON null and a missing key read the same. */
  fun isAbsent(value: Any?): Boolean = value == null || value == org.json.JSONObject.NULL

  fun invalid(key: String) = ProtocolException(ProtocolError.FIELD_MISSING_OR_INVALID, "field $key is missing or invalid")
}
