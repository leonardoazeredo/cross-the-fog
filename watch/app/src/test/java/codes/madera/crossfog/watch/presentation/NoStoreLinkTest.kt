package codes.madera.crossfog.watch.presentation

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The watch app talks to no app store. A store host is a network host the app would name in its audit, and the
 * rating prompt that used it pointed at an upstream listing, so no Kotlin source or `strings.xml` under `src/main` may
 * mention one again. The manifest and assets are not read: the theme assets hold unrelated `vending` rules.
 */
class NoStoreLinkTest {
    // Lower case: hosts and schemes ignore case, so the text is lowered before it is searched.
    private val forbidden = listOf("play.google.com", "com.android.vending", "market://")

    @Test
    fun noSourceOrStringNamesAnAppStore() {
        val main = File("src/main")
        assertTrue("run from the app module: ${main.absolutePath}", main.isDirectory)
        val scanned =
            main.walkTopDown().filter { it.isFile && (it.extension == "kt" || it.name == "strings.xml") }.toList()
        // A filter that matches nothing would pass every hit-free check below.
        assertTrue("no .kt file was scanned", scanned.any { it.extension == "kt" })
        assertTrue("no strings.xml was scanned", scanned.any { it.name == "strings.xml" })
        val hits =
            scanned
                .filter { file -> file.readText().lowercase().let { text -> forbidden.any { it in text } } }
                .map { it.relativeTo(main).path }
                .sorted()
        assertEquals(emptyList<String>(), hits)
    }
}
