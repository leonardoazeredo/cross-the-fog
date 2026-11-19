package codes.madera.crossfog.watch.presentation.features.maps.theme.bundled

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The bundled themes whose licence is free: OpenHiking (CC BY-SA) and `hiking-3d` (the tree's MIT). */
class OnlyFreeLicenceThemesBundledTest {
    private val main = File("src/main")
    private val assets = File(main, "assets")

    @Test
    fun onlyTheKeptThemesAreUnderAssetsTheme() {
        val dirs = File(assets, "theme").listFiles()
        assertTrue("assets/theme was not found from ${File(".").absolutePath}", dirs != null && dirs.isNotEmpty())
        assertEquals(listOf("hiking-3d", "openhiking"), dirs!!.map { it.name }.sorted())
    }

    @Test
    fun noRemovedThemeLeavesFilesAtTheAssetsRootOrInTheResourceFolder() {
        listOf("Elevate.xml", "read_me_elevate.txt", "ele-res").forEach { name ->
            assertFalse("assets/$name is back", File(assets, name).exists())
        }
    }

    @Test
    fun everyBundledThemeHasItsXmlInItsFolder() {
        assertTrue(File(assets, "theme/openhiking/OpenHiking.xml").isFile)
        assertTrue(File(assets, "theme/hiking-3d/hiking-3d.xml").isFile)
    }

    @Test
    fun noLicenceTextOrScreenNamesARemovedThemeAsBundled() {
        val removed =
            Regex("""elevate|french.?kiss|tiramisu|voluntary|hike,? ride|os.map theme""", RegexOption.IGNORE_CASE)
        val texts =
            listOfNotNull(
                File(assets, "licenses").listFiles()?.toList(),
                File(main, "res").listFiles { f -> f.isDirectory && f.name.startsWith("raw") }
                    ?.flatMap { it.listFiles()?.toList().orEmpty() },
            ).flatten()
        assertTrue("no licence text was found from ${File(".").absolutePath}", texts.size > 20)
        val hits =
            texts
                .filter { it.isFile && (it.extension == "md" || it.extension == "txt") }
                .filter { removed.containsMatchIn(it.readText()) }
                .map { it.path }
        assertEquals("licence texts still name a removed theme", emptyList<String>(), hits)
    }
}
