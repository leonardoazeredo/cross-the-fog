package codes.madera.crossfog.link

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Runs `vectors/messages.json`; the phone module's tests run the same file, so both ends read it alike. */
class VectorsTest {
  private fun cases(): JSONArray {
    val text = javaClass.getResourceAsStream("/vectors/messages.json")!!.use { String(it.readBytes(), Charsets.UTF_8) }
    return JSONObject(text).getJSONArray("cases")
  }

  private fun unhex(hex: String) = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  @Test
  fun everyVectorGivesWhatItSays() {
    val all = cases()
    assertTrue(all.length() > 20)
    for (i in 0 until all.length()) {
      val c = all.getJSONObject(i)
      val name = c.getString("name")
      val frame = unhex(c.getString("frame"))
      if (c.has("error")) {
        val e = try {
          Messages.parse(Framing.decode(frame))
          fail("$name: was accepted")
          return
        } catch (e: ProtocolException) {
          e
        }
        assertEquals(name, c.getString("error"), e.error.name)
      } else {
        val canonical = c.getString("canonical").toByteArray(Charsets.UTF_8)
        val message = Messages.parse(Framing.decode(frame))
        assertArrayEquals(name, canonical, Messages.encode(message))
        if (c.getBoolean("roundTrip")) assertArrayEquals(name, frame, Framing.encode(canonical))
      }
    }
  }
}
