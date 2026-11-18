package codes.madera.crossfog.link

import org.json.JSONObject

/** Proves the wiring of this module in both builds; the protocol replaces it. */
object LinkBuild {
  const val PROTOCOL_VERSION = 1

  fun hello(): String = JSONObject().put("v", PROTOCOL_VERSION).toString()
}
