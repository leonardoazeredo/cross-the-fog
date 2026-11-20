package codes.madera.crossfog.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Nothing the watch sends may leave it unencrypted, and every address it downloads from is `https`, so the manifest
 * allows no plain HTTP. A host that really needs it must be named in a network security config, and that config
 * and its exception are listed in `watch/UPSTREAM.md`, so adding one fails here until this test is updated with it.
 */
class ManifestCleartextTest {
    private val manifest: String
        get() {
            val file = File("src/main/AndroidManifest.xml")
            assertTrue("run from the app module: ${file.absolutePath}", file.isFile)
            return file.readText()
        }

    @Test
    fun theApplicationForbidsCleartextTraffic() {
        val flag = Regex("""android:usesCleartextTraffic\s*=\s*"([^"]*)"""")
        assertEquals(listOf("false"), flag.findAll(manifest).map { it.groupValues[1] }.toList())
    }

    @Test
    fun noNetworkSecurityConfigAddsAnException() {
        assertFalse(
            "a network security config needs its exceptions listed in watch/UPSTREAM.md and this test updated",
            manifest.contains("networkSecurityConfig"),
        )
    }
}
