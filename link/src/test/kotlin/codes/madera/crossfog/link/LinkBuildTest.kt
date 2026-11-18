package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Test

class LinkBuildTest {
  @Test
  fun helloIsJsonWithTheProtocolVersion() {
    assertEquals("""{"v":1}""", LinkBuild.hello())
  }
}
