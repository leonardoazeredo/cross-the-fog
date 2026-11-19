package codes.madera.crossfog.platform

import android.os.Debug
import androidx.test.ext.junit.runners.AndroidJUnit4
import codes.madera.crossfog.link.Framing
import codes.madera.crossfog.link.Items
import codes.madera.crossfog.link.Revision
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Reading one maximum-size staged or queued item on a device allocates about two copies of it (2.5 at
 * most; 2.0 measured), so a byte array of the track made anywhere in the read, one more copy, fails. `link/`'s JVM test measures the Maven org.json, which builds every string through
 * a builder; Android's does not for text with no escapes, so this is the number a watch heap sees.
 */
@RunWith(AndroidJUnit4::class)
class ReadAllocationTest {
  private val id = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
  private val routeId = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0002"

  /** A queued route has no revision; a received one always carries it, which is hashed against the gpx when read. */
  private fun item(kind: Kind): ByteArray {
    val shell = if (kind == Kind.ACTIVITY) {
      """{"activityId":"$id","encoderVersion":"1","gpx":"@GPX@"}"""
    } else {
      """{"routeId":"$routeId","name":"n","createdAt":"2026-01-02T03:04:05Z",@REVISION@"gpx":"@GPX@"}"""
    }
    // Under the cap once framed: the frame adds an envelope and, for a route, a revision.
    val room = Framing.MAX_FRAME_BYTES - shell.length - 300
    val unit = "<trkpt lat='1' lon='2'/>"
    val gpx = StringBuilder(room + unit.length).apply { while (length < room) append(unit) }.toString()
    val revision = if (kind == Kind.ROUTE_WITH_REVISION) """"revision":"${Revision.of(gpx)}",""" else ""
    return shell.replace("@REVISION@", revision).replace("@GPX@", gpx).toByteArray(Charsets.UTF_8)
  }

  private enum class Kind { ACTIVITY, ROUTE, ROUTE_WITH_REVISION }

  /** Bytes the runtime allocated while [block] ran; counts everything allocated in the process, so the test keeps nothing else busy. */
  private fun allocated(block: () -> Unit): Long {
    repeat(2) { block() }
    val before = Debug.getRuntimeStat("art.gc.bytes-allocated").toLong()
    block()
    return Debug.getRuntimeStat("art.gc.bytes-allocated").toLong() - before
  }

  @Test
  fun readingAMaximumSizeActivityAllocatesAboutTwoCopies() = check(Kind.ACTIVITY)

  @Test
  fun readingAMaximumSizeRouteAllocatesAboutTwoCopies() = check(Kind.ROUTE)

  @Test
  fun readingAMaximumSizeRouteThatCarriesItsRevisionAllocatesAboutTwoCopies() = check(Kind.ROUTE_WITH_REVISION)

  private fun check(kind: Kind) {
    val bytes = item(kind)
    assertTrue(bytes.size > Framing.MAX_FRAME_BYTES - 1024)
    val copies = allocated { if (kind == Kind.ACTIVITY) Items.activityOffer(bytes) else Items.routeOffer(bytes) }.toDouble() / bytes.size
    assertTrue("$kind: read allocated $copies copies of the item", copies <= MAX_COPIES)
  }

  private companion object {
    const val MAX_COPIES = 2.5
  }
}
