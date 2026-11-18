package codes.madera.crossfog.platform

import codes.madera.crossfog.link.Framing
import codes.madera.crossfog.link.Messages
import codes.madera.crossfog.link.ProtocolException
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The same `vectors/messages.json` that `:link:test` runs (shared through the test resources path in build.gradle). */
class LinkVectorsTest {
  private fun unhex(hex: String) = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  @Test
  fun everyVectorGivesWhatItSaysInThisBuildToo() {
    val text = javaClass.getResourceAsStream("/vectors/messages.json")!!.use { String(it.readBytes(), Charsets.UTF_8) }
    val all = JSONObject(text).getJSONArray("cases")
    assertTrue(all.length() > 20)
    for (i in 0 until all.length()) {
      val c = all.getJSONObject(i)
      val name = c.getString("name")
      val frame = unhex(c.getString("frame"))
      if (c.has("error")) {
        try {
          Messages.parse(Framing.decode(frame))
          fail("$name: was accepted")
        } catch (e: ProtocolException) {
          assertEquals(name, c.getString("error"), e.error.name)
        }
      } else {
        val canonical = c.getString("canonical").toByteArray(Charsets.UTF_8)
        assertArrayEquals(name, canonical, Messages.encode(Messages.parse(Framing.decode(frame))))
        if (c.getBoolean("roundTrip")) assertArrayEquals(name, frame, Framing.encode(canonical))
      }
    }
  }
}
