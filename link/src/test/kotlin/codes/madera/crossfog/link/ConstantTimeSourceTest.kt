package codes.madera.crossfog.link

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A timing difference cannot be seen by a test that only reads results, so these read the source:
 * the two places that compare a secret or a pin use [java.security.MessageDigest.isEqual].
 */
class ConstantTimeSourceTest {
  private fun source(name: String): String {
    val dir = File("src/main/kotlin/codes/madera/crossfog/link")
    return File(dir, name).readText()
  }

  @Test
  fun thePinIsComparedWithMessageDigestIsEqualOnly() {
    val s = source("PinningTrustManager.kt")
    assertTrue(s.contains("MessageDigest.isEqual(hash, pin)"))
    assertFalse(s.contains("contentEquals"))
  }

  @Test
  fun theProofIsComparedWithMessageDigestIsEqualOnly() {
    val s = source("Pairing.kt")
    assertTrue(s.contains("MessageDigest.isEqual(expected, "))
    assertFalse(s.contains("contentEquals"))
    assertFalse(s.contains("proofHex =="))
  }
}
