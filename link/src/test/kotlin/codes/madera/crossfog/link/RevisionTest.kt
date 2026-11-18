package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Test

class RevisionTest {
  @Test
  fun isTheLowercaseHexSha256OfTheUtf8Text() {
    // FIPS 180-2 test vector.
    assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Revision.of("abc"))
  }

  @Test
  fun hashesTheUtf8BytesOfNonAsciiText() {
    // "é" is the two bytes c3 a9 in UTF-8.
    assertEquals("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c", Revision.of("é"))
  }

  @Test
  fun aShapeCheckAcceptsOnlySixtyFourLowercaseHexDigits() {
    assertEquals(true, Revision.isWellFormed(Revision.of("x")))
    assertEquals(false, Revision.isWellFormed(Revision.of("x").uppercase()))
    assertEquals(false, Revision.isWellFormed("abc"))
    assertEquals(false, Revision.isWellFormed("g".repeat(64)))
  }
}
