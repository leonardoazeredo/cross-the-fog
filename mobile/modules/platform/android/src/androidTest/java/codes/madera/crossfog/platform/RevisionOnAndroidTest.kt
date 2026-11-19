package codes.madera.crossfog.platform

import androidx.test.ext.junit.runners.AndroidJUnit4
import codes.madera.crossfog.link.Revision
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/** `Revision.of` on Android's own encoder gives the SHA-256 of the text's UTF-8 bytes, across its slice boundary and for text that is all three-byte characters. */
@RunWith(AndroidJUnit4::class)
class RevisionOnAndroidTest {
  private fun expected(text: String) =
    MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

  @Test
  fun aFourByteCharacterAtTheSliceBoundaryIsHashedWhole() {
    for (pad in 0..4) {
      val text = "a".repeat(16 * 1024 - 2 + pad) + "😀" + "b".repeat(40_000) + "é€"
      assertEquals("pad $pad", expected(text), Revision.of(text))
    }
  }

  @Test
  fun textOfThreeByteCharactersIsHashedWhole() {
    for (text in listOf("€".repeat(40_000), "ࠀ".repeat(16 * 1024), "€".repeat(16 * 1024 + 1))) {
      assertEquals(expected(text), Revision.of(text))
    }
  }

  @Test
  fun anUnpairedSurrogateIsHashedAsAQuestionMark() {
    for (text in listOf("\ud800", "a\udc00b", "x\ud83d", "\udc00😀", "a".repeat(16 * 1024 - 1) + "\ud83d" + "x")) {
      assertEquals(expected(text), Revision.of(text))
    }
    // Two high surrogates with the second at the end of a slice: the first has no low half, the second may start a pair.
    for (pad in 0..3) {
      for (middle in listOf("\ud83d\ud83d", "\ud83d\ud83dx", "\ud83d\ud83d\ude00")) {
        val text = "a".repeat(16 * 1024 - 2 + pad) + middle + "b"
        assertEquals("pad $pad middle ${middle.length}", expected(text), Revision.of(text))
      }
    }
  }
}
