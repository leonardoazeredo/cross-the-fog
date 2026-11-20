package codes.madera.crossfog.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Nothing the watch sends may leave it unencrypted, and every address it downloads from is `https`, so the manifest
 * allows no plain HTTP. A host that really needs it must be named in a network security config, and that config
 * and its exception are listed in `watch/UPSTREAM.md`, so adding one fails here until this test is updated with it.
 * Every source set's manifest is read, because a `debug` or `release` one would be merged over the main one.
 */
class ManifestCleartextTest {
    private val manifests: Map<String, String>
        get() {
            val src = File("src")
            assertTrue("run from the app module: ${src.absolutePath}", src.isDirectory)
            return src
                .listFiles { dir -> File(dir, "AndroidManifest.xml").isFile }
                .orEmpty()
                .associate { it.name to File(it, "AndroidManifest.xml").readText() }
        }

    private val flag = Regex("""android:usesCleartextTraffic\s*=\s*"([^"]*)"""")

    @Test
    fun theMainManifestForbidsCleartextTraffic() {
        val main = manifests["main"] ?: error("no src/main/AndroidManifest.xml")
        assertEquals(listOf("false"), flag.findAll(main).map { it.groupValues[1] }.toList())
    }

    @Test
    fun noOtherSourceSetTouchesTheFlag() {
        val others = manifests.filterKeys { it != "main" }.filterValues { flag.containsMatchIn(it) }
        assertEquals(emptySet<String>(), others.keys)
    }

    @Test
    fun noNetworkSecurityConfigAddsAnException() {
        val named = manifests.filterValues { it.contains("networkSecurityConfig") }
        assertEquals(
            "a network security config needs its exceptions listed in watch/UPSTREAM.md and this test updated",
            emptySet<String>(),
            named.keys,
        )
    }
}
