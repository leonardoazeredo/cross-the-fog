package codes.madera.crossfog.watch

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The watch's minSdk is 29, so a `Build.VERSION.SDK_INT` test against 29 or lower has one branch that never runs.
 * The check is on the level named, not on the comparison, so a new `>= Q` fails here the day it is written.
 */
class NoDeadSdkChecksTest {
    private val levelsAtOrBelowMinSdk =
        Regex(
            "VERSION_CODES\\.(BASE\\w*|CUPCAKE|DONUT|ECLAIR\\w*|FROYO|GINGERBREAD\\w*|HONEYCOMB\\w*|" +
                "ICE_CREAM_SANDWICH\\w*|JELLY_BEAN\\w*|KITKAT\\w*|LOLLIPOP\\w*|M|N|N_MR1|O|O_MR1|P|Q)\\b",
        )
    private val numericLevel = Regex("""\bSDK_INT\s*(<|<=|>|>=|==)\s*(\d|1\d|2\d)\b""")

    private fun minSdk(gradle: File): Int? =
        Regex("""minSdk\s*=\s*(\d+)""").find(gradle.readText())?.groupValues?.get(1)?.toInt()

    @Test
    fun noSourceTestsAnApiLevelTheMinSdkAlreadyGuarantees() {
        val gradle = File("build.gradle.kts")
        assertTrue("run from the app module: ${gradle.absolutePath}", gradle.isFile)
        assertEquals("update the levels above with the minSdk", 29, minSdk(gradle))
        val offenders =
            File("src/main")
                .walkTopDown()
                .filter { it.isFile && it.extension == "kt" }
                .flatMap { file ->
                    file
                        .readLines()
                        .withIndex()
                        .filter { (_, line) -> !line.trimStart().startsWith("//") && deadLevel(line) }
                        .map { (i, line) -> "${file.path}:${i + 1}: ${line.trim()}" }
                }.toList()
        val report = offenders.joinToString("\n")
        assertTrue("these tests a level minSdk 29 already guarantees:\n$report", offenders.isEmpty())
    }

    private fun deadLevel(line: String) =
        levelsAtOrBelowMinSdk.containsMatchIn(line) || numericLevel.containsMatchIn(line)
}
