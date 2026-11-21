package codes.madera.crossfog.watch.link

import codes.madera.crossfog.watch.presentation.features.gpx.ParsedGpxData
import codes.madera.crossfog.watch.presentation.features.gpx.parseGpxData
import java.io.File
import java.io.IOException

/**
 * Whether the watch's own GPX parser finds points in [bytes]: what this watch can show and navigate is what it
 * accepts. That parser reads a file and answers one it cannot read with no points rather than an error, so the
 * bytes go through a temporary file in [tempDir] that is removed again, and nothing unreadable is ever filed
 * in the GPX directory. For the same reason an empty answer proves the route unreadable only if the temporary
 * file was still there to be read: one that vanished meanwhile (the system clearing its cache) is an
 * [IOException], not a verdict, because a verdict sets the route aside for good.
 */
internal fun gpxIsReadable(
    bytes: ByteArray,
    tempDir: File,
    parse: (File) -> ParsedGpxData = ::parseGpxData,
): Boolean {
    val temp = File.createTempFile("route-check", ".gpx", tempDir)
    try {
        temp.writeBytes(bytes)
        val points = parse(temp).points
        if (points.isNotEmpty()) return true
        if (temp.length() != bytes.size.toLong()) throw IOException("the check file changed while it was read")
        return false
    } finally {
        temp.delete()
    }
}
