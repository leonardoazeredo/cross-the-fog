package codes.madera.crossfog.watch.presentation

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The watch app talks to no app store. A store host is a network host the app would name in its audit, and the
 * rating prompt that used it pointed at an upstream listing, so nothing under `src/main` may mention one again.
 */
class NoStoreLinkTest {
    private val forbidden = listOf("play.google.com", "com.android.vending")

    @Test
    fun noSourceOrStringNamesAnAppStore() {
        val main = File("src/main")
        assertEquals("run from the app module: ${main.absolutePath}", true, main.isDirectory)
        val hits =
            main
                .walkTopDown()
                .filter { it.isFile && (it.extension == "kt" || it.name == "strings.xml") }
                .filter { file -> file.readText().let { text -> forbidden.any { it in text } } }
                .map { it.relativeTo(main).path }
                .sorted()
                .toList()
        assertEquals(emptyList<String>(), hits)
    }
}
