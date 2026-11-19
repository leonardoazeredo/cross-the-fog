package codes.madera.crossfog.watch.presentation.features.navigate

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Going off route shows a warning with no way to ask for a way back: on-watch routing is gone, so the old "Guide"
 * button drew a straight line to the track. The warning card stays; only the button and the dashboard shortcut went.
 */
class NoGuideBackButtonTest {
    // Whitespace and trailing-comma tolerant: the formatter breaks `acceptText =` and the call over lines.
    private val forbidden =
        mapOf(
            "a Guide button on a prompt card" to Regex("""acceptText\s*=\s*stringResource\(\s*R\.string\.navigate_guide\s*,?\s*\)"""),
            "the guide-back question" to Regex("""R\.string\.navigate_guide_back\b"""),
            "the guide-back card title" to Regex("""R\.string\.navigate_route_back\b"""),
            "the guide-back card detail" to Regex("""R\.string\.navigate_create_route_to_gpx\b"""),
            "the guide-back shortcut icon" to Regex("""R\.string\.navigate_route_back_to_gpx\b"""),
            "a guide-back shortcut" to Regex("""GuideBackShortcut"""),
        )

    @Test
    fun noKotlinSourceOffersAWayBackToTheRoute() {
        val ui = File("src/main/java/codes/madera/crossfog/watch/presentation/features/navigate")
        assertTrue("run from the app module: ${ui.absolutePath}", ui.isDirectory)
        val files = ui.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        // A walk that read nothing would pass every check below.
        assertTrue("no .kt file was scanned", files.size > 10)
        val hits =
            files.flatMap { file ->
                val text = file.readText()
                forbidden.filterValues { it.containsMatchIn(text) }.keys.map { "${file.name}: $it" }
            }.sorted()
        assertEquals(emptyList<String>(), hits)
    }
}
