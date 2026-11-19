package codes.madera.crossfog.platform

import androidx.test.ext.junit.runners.AndroidJUnit4
import codes.madera.crossfog.link.Framing
import codes.madera.crossfog.link.Messages
import codes.madera.crossfog.link.ProtocolException
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * `link/`'s protocol vectors on the org.json this device ships (the JVM runs use the Maven artifact),
 * so what is accepted, refused and encoded is the same on the phone and the watch as in the shared file.
 */
@RunWith(AndroidJUnit4::class)
class LinkVectorsAndroidTest {
  private fun unhex(hex: String) = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  @Test
  fun everyVectorGivesWhatItSaysOnAndroidsOrgJson() {
    val text = javaClass.getResourceAsStream("/vectors/messages.json")!!.use { String(it.readBytes(), Charsets.UTF_8) }
    val all = JSONObject(text).getJSONArray("cases")
    assertTrue(all.length() > 20)
    val wrong = mutableListOf<String>()
    for (i in 0 until all.length()) {
      val c = all.getJSONObject(i)
      val name = c.getString("name")
      val frame = unhex(c.getString("frame"))
      if (c.has("error")) {
        val got = try {
          Messages.parse(Framing.decode(frame))
          "accepted"
        } catch (e: ProtocolException) {
          e.error.name
        }
        if (got != c.getString("error")) wrong += "$name: wanted ${c.getString("error")}, got $got"
      } else {
        val canonical = c.getString("canonical").toByteArray(Charsets.UTF_8)
        val message = Messages.parse(Framing.decode(frame))
        assertArrayEquals(name, canonical, Messages.encode(message))
        if (c.getBoolean("roundTrip")) assertArrayEquals(name, frame, Framing.encode(canonical))
      }
    }
    assertEquals(emptyList<String>(), wrong)
  }
}
