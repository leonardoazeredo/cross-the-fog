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
  private val sources = "src/main/kotlin/codes/madera/crossfog/link"

  // Looked up from wherever the runner starts, so a runner that changes the working directory still finds it.
  private fun source(name: String): String {
    var dir: File? = File("").absoluteFile
    while (dir != null) {
      for (module in listOf(dir, File(dir, "link"))) {
        val file = File(module, "$sources/$name")
        if (file.isFile) return file.readText()
      }
      dir = dir.parentFile
    }
    error("$sources/$name not found from ${File("").absolutePath} or any parent")
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
