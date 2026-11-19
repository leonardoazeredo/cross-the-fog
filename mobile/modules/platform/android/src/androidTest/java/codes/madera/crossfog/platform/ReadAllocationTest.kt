package codes.madera.crossfog.platform

import android.os.Debug
import androidx.test.ext.junit.runners.AndroidJUnit4
import codes.madera.crossfog.link.Framing
import codes.madera.crossfog.link.Items
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Reading one maximum-size staged or queued item on a device allocates no more than about three copies
 * of it (two measured). `link/`'s JVM test measures the Maven org.json, which builds every string through
 * a builder; Android's does not for text with no escapes, so this is the number a watch heap sees.
 */
@RunWith(AndroidJUnit4::class)
class ReadAllocationTest {
  private val id = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
  private val routeId = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0002"

  private fun item(route: Boolean): ByteArray {
    val shell = if (route) {
      """{"routeId":"$routeId","name":"n","createdAt":"2026-01-02T03:04:05Z","gpx":"@"}"""
    } else {
      """{"activityId":"$id","encoderVersion":"1","gpx":"@"}"""
    }
    // Under the cap once framed: the frame adds an envelope and, for a route, a revision.
    val room = Framing.MAX_FRAME_BYTES - shell.length - 300
    val unit = "<trkpt lat='1' lon='2'/>"
    val gpx = StringBuilder(room + unit.length).apply { while (length < room) append(unit) }.toString()
    return shell.replace("@", gpx).toByteArray(Charsets.UTF_8)
  }

  /** Bytes the runtime allocated while [block] ran; counts everything allocated in the process, so the test keeps nothing else busy. */
  private fun allocated(block: () -> Unit): Long {
    repeat(2) { block() }
    val before = Debug.getRuntimeStat("art.gc.bytes-allocated").toLong()
    block()
    return Debug.getRuntimeStat("art.gc.bytes-allocated").toLong() - before
  }

  @Test
  fun readingAMaximumSizeActivityAllocatesAtMostAboutThreeCopies() = check(route = false)

  @Test
  fun readingAMaximumSizeRouteAllocatesAtMostAboutThreeCopies() = check(route = true)

  private fun check(route: Boolean) {
    val bytes = item(route)
    assertTrue(bytes.size > Framing.MAX_FRAME_BYTES - 1024)
    val copies = allocated { if (route) Items.routeOffer(bytes) else Items.activityOffer(bytes) }.toDouble() / bytes.size
    android.util.Log.i("ALLOC", "route=$route item=${bytes.size} copies=$copies")
    assertTrue("read allocated $copies copies of the item", copies <= MAX_COPIES)
  }

  private companion object {
    const val MAX_COPIES = 3.0
  }
}
