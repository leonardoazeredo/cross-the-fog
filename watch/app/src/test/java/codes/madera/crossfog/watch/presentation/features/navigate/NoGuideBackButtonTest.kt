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
    private val guideAcceptButton =
        Regex("""acceptText\s*=\s*stringResource\(\s*R\.string\.navigate_guide\s*,?\s*\)""")

    // Text only the removed guide-back offer used, in Kotlin sources.
    private val inSources =
        mapOf(
            "a Guide button on a prompt card" to guideAcceptButton,
            "the guide-back question" to Regex("""R\.string\.navigate_guide_back\b"""),
            "the guide-back card title" to Regex("""R\.string\.navigate_route_back\b"""),
            "the guide-back card detail" to Regex("""R\.string\.navigate_create_route_to_gpx\b"""),
            "the guide-back shortcut icon" to Regex("""R\.string\.navigate_route_back_to_gpx\b"""),
            "a guide-back shortcut" to Regex("""GuideBackShortcut"""),
            // The callback is still a parameter of the overlays, so a shortcut under any name would call it, or hand it
            // to a card's accept button.
            "a call to the guide-back callback" to Regex("""\bonGuideBackToRoute\s*\("""),
            "the guide-back callback as an accept action" to Regex("""onAccept\s*=\s*onGuideBackToRoute\b"""),
        )

    private val removedStrings =
        listOf(
            "navigate_guide_back",
            "navigate_route_back",
            "navigate_create_route_to_gpx",
            "navigate_route_back_to_gpx",
        )

    @Test
    fun noKotlinSourceOffersAWayBackToTheRoute() {
        val main = File("src/main")
        assertTrue("run from the app module: ${main.absolutePath}", main.isDirectory)
        val kotlin = main.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        // A walk that read nothing would pass every check below.
        assertTrue("too few .kt files were scanned: ${kotlin.size}", kotlin.size > 100)
        val hits =
            kotlin
                .flatMap { file ->
                    val text = file.readText()
                    inSources.filterValues { it.containsMatchIn(text) }.keys.map { "${file.name}: $it" }
                }.sorted()
        assertEquals(emptyList<String>(), hits)
    }

    @Test
    fun theStringsOnlyTheGuideBackOfferUsedStayDeleted() {
        val main = File("src/main")
        assertTrue("run from the app module: ${main.absolutePath}", main.isDirectory)
        val xml = main.walkTopDown().filter { it.isFile && it.name == "strings.xml" }.toList()
        assertTrue("too few strings.xml files were scanned: ${xml.size}", xml.size >= 6)
        val hits =
            xml
                .flatMap { file ->
                    val text = file.readText()
                    removedStrings.filter { """name="$it"""" in text }.map { "${file.parentFile.name}: $it" }
                }.sorted()
        assertEquals(emptyList<String>(), hits)
    }
}
