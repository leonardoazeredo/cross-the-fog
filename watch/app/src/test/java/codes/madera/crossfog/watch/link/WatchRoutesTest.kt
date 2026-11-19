package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.RouteOffer
import codes.madera.crossfog.link.SaveResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.security.MessageDigest

class WatchRoutesTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val index = MemoryIndex()
    private val written = mutableListOf<String>()
    private var failWrite: Exception? = null
    private var shaOverride: String? = null

    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun routes() =
        WatchRoutes(
            index = index,
            write = { name, bytes ->
                failWrite?.let { throw it }
                File(tmp.root, name).writeBytes(bytes)
                written += name
                shaOverride ?: sha(bytes)
            },
            fileExists = { File(tmp.root, it).isFile },
        )

    private fun offer(
        id: String = ID_A,
        gpx: String = "<gpx>one</gpx>",
    ) = RouteOffer(id, "Morning loop", "2026-03-01T09:30:00Z", gpx)

    @Test
    fun aNewRouteIsSavedAsAGpxFileAndIndexedByItsIdAndRevision() {
        val o = offer()
        assertEquals(SaveResult.SAVED, routes().save(o))
        val entry = index.get(ID_A)!!
        assertEquals(o.revision, entry.revision)
        assertEquals("<gpx>one</gpx>", File(tmp.root, entry.file).readText())
        assertTrue(entry.file.endsWith(".gpx"))
    }

    @Test
    fun theSameRevisionAgainIsAlreadyHeldAndWritesNothing() {
        val r = routes()
        r.save(offer())
        written.clear()
        assertEquals(SaveResult.ALREADY_HELD, r.save(offer()))
        assertTrue(written.isEmpty())
    }

    @Test
    fun aNewRevisionOfTheSameRouteReplacesTheFileInPlace() {
        val r = routes()
        r.save(offer())
        val first = index.get(ID_A)!!
        assertEquals(SaveResult.SAVED, r.save(offer(gpx = "<gpx>two</gpx>")))
        val second = index.get(ID_A)!!
        assertEquals(first.file, second.file)
        assertEquals("<gpx>two</gpx>", File(tmp.root, second.file).readText())
        assertEquals(offer(gpx = "<gpx>two</gpx>").revision, second.revision)
    }

    @Test
    fun aRouteWhoseFileWasDeletedIsSavedAgainEvenThoughTheIndexHasIt() {
        val r = routes()
        r.save(offer())
        File(tmp.root, index.get(ID_A)!!.file).delete()
        assertEquals(SaveResult.SAVED, r.save(offer()))
        assertTrue(File(tmp.root, index.get(ID_A)!!.file).isFile)
    }

    @Test
    fun twoRoutesKeepTwoFiles() {
        val r = routes()
        r.save(offer(ID_A, "<gpx>a</gpx>"))
        r.save(offer(ID_B, "<gpx>b</gpx>"))
        assertFalse(index.get(ID_A)!!.file == index.get(ID_B)!!.file)
    }

    @Test
    fun aFailedWriteIsAnErrorAndLeavesTheIndexAlone() {
        val r = routes()
        r.save(offer())
        failWrite = IOException("disk full")
        assertThrows(IOException::class.java) { r.save(offer(gpx = "<gpx>two</gpx>")) }
        assertEquals(offer().revision, index.get(ID_A)!!.revision)
    }

    @Test
    fun aWriteThatReportsAnotherHashThanTheRevisionIsAnErrorAndIsNotIndexed() {
        shaOverride = "0".repeat(64)
        assertThrows(IOException::class.java) { routes().save(offer()) }
        assertEquals(null, index.get(ID_A))
    }

    @Test
    fun aWriteThatReportsNoHashIsAnError() {
        val r =
            WatchRoutes(index, { _, _ -> null }, { false })
        assertThrows(IOException::class.java) { r.save(offer()) }
        assertEquals(null, index.get(ID_A))
    }

    @Test
    fun theFileNameNeverComesFromThePeersText() {
        val o = RouteOffer(ID_A, "../../etc/passwd", "2026-03-01T09:30:00Z", "<gpx>x</gpx>")
        routes().save(o)
        assertEquals("route-$ID_A.gpx", index.get(ID_A)!!.file)
    }
}
