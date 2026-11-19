package codes.madera.crossfog.watch.presentation.features.routetools

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class GpxRouteEditorFileNamesTest {
    @Test
    fun aPlainTitleBecomesItsOwnFileName() {
        assertEquals("Morning-loop.gpx", buildRenamedGpxFileName("Morning loop"))
        assertEquals("Col_du-Galibier.2.gpx", buildRenamedGpxFileName("Col_du Galibier.2"))
    }

    @Test
    fun oneTrailingGpxSuffixIsNotDoubledWhateverItsCase() {
        assertEquals("Trail.gpx", buildRenamedGpxFileName("Trail.gpx"))
        assertEquals("Trail.gpx", buildRenamedGpxFileName("Trail.GPX"))
        assertEquals("Trail.gpx.gpx", buildRenamedGpxFileName("Trail.gpx.gpx"))
    }

    @Test
    fun pathSeparatorsAndParentReferencesCannotLeaveTheDirectory() {
        for (hostile in listOf("../etc/passwd", "..\\..\\x", "/absolute/path", "a/b/c", "a\\b", "../", "/", "x/../../y")) {
            val name = buildRenamedGpxFileName(hostile)
            assertFalse("$hostile -> $name has a separator", name.contains('/') || name.contains('\\'))
            assertEquals("$hostile -> $name is not one path part", name, File(name).name)
            assertTrue(name.endsWith(".gpx"))
        }
        assertEquals("..-etc-passwd.gpx", buildRenamedGpxFileName("../etc/passwd"))
        assertEquals("a-b-c.gpx", buildRenamedGpxFileName("a/b/c"))
    }

    @Test
    fun anEmptyOrBlankOrAllUnsupportedTitleFallsBackToTheDefaultName() {
        assertEquals("gpx-edit.gpx", buildRenamedGpxFileName(""))
        assertEquals("gpx-edit.gpx", buildRenamedGpxFileName("   "))
        assertEquals("gpx-edit.gpx", buildRenamedGpxFileName("///"))
        assertEquals("gpx-edit.gpx", buildRenamedGpxFileName("日本語"))
        assertEquals("gpx-edit.gpx", buildRenamedGpxFileName(".gpx"))
    }

    @Test
    fun nonAsciiLettersAreReplacedNotKept() {
        assertEquals("Caf-Montagne.gpx", buildRenamedGpxFileName("Café Montagne"))
        assertEquals("Wanderung-Z-rich.gpx", buildRenamedGpxFileName("Wanderung Zürich"))
    }

    @Test
    fun runsOfUnsupportedCharactersBecomeOneDashAndEdgeDashesAreTrimmed() {
        assertEquals("a-b.gpx", buildRenamedGpxFileName("a   ***   b"))
        assertEquals("a.gpx", buildRenamedGpxFileName("--a--"))
    }
}
