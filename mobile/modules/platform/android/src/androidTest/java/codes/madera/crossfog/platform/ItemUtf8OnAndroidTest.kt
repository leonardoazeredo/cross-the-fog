package codes.madera.crossfog.platform

import androidx.test.ext.junit.runners.AndroidJUnit4
import codes.madera.crossfog.link.Items
import codes.madera.crossfog.link.ProtocolError
import codes.madera.crossfog.link.ProtocolException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

/** Android's UTF-8 decoder, run through the read's 8192-char check buffer: bad bytes anywhere are refused, a character across the buffer's edge is kept. */
@RunWith(AndroidJUnit4::class)
class ItemUtf8OnAndroidTest {
  private val id = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"

  private fun item(gpx: String) = """{"activityId":"$id","encoderVersion":"1","gpx":"$gpx"}""".toByteArray(Charsets.UTF_8)

  private fun refused(bytes: ByteArray) =
    assertEquals(ProtocolError.NOT_A_JSON_OBJECT, assertThrows(ProtocolException::class.java) { Items.activityOffer(bytes) }.error)

  @Test
  fun aBadByteAnywhereIsRefused() {
    val good = item("x".repeat(20_000))
    for (at in listOf(5, 8191, 8192, 8193, 16_383, 16_384, good.size - 3)) {
      refused(good.copyOf().also { it[at] = 0xff.toByte() })
    }
    refused(good + byteArrayOf(0xc3.toByte()))
    // Overlong: U+0000 as two bytes.
    refused(item("x").let { it.copyOf(it.size - 3) + byteArrayOf(0xc0.toByte(), 0x80.toByte(), '"'.code.toByte(), '}'.code.toByte()) })
  }

  @Test
  fun aMultibyteCharacterAcrossTheBufferEdgeIsKept() {
    // The item's text before the gpx is `prefix` chars, so the run starts at char 8184 + pad: the pair of 😀 is split by the edge at pad 5.
    val prefix = item("").size - 2
    for (pad in 0..8) {
      val gpx = "x".repeat(8184 + pad - prefix) + "é€😀" + "y".repeat(200)
      assertEquals(gpx, Items.activityOffer(item(gpx)).gpx)
    }
  }
}
