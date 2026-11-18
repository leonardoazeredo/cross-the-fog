package codes.madera.crossfog.link

import org.json.JSONObject

/** Exists so both Gradle builds compile this module and run its test, with org.json resolved. */
object LinkBuild {
  const val PROTOCOL_VERSION = 1

  fun hello(): String = JSONObject().put("v", PROTOCOL_VERSION).toString()
}
