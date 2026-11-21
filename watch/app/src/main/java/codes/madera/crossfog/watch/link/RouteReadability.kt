package codes.madera.crossfog.watch.link

import codes.madera.crossfog.watch.presentation.features.gpx.parseGpxData
import java.io.File

/**
 * Whether the watch's own GPX parser finds points in [bytes]: what this watch can show and navigate is what it
 * accepts. That parser reads a file and answers one it cannot read with no points rather than an error, so the
 * bytes go through a temporary file in [tempDir] that is removed again, and nothing unreadable is ever filed
 * in the GPX directory. A temporary file that cannot be written is an [java.io.IOException], not a verdict.
 */
internal fun gpxIsReadable(
    bytes: ByteArray,
    tempDir: File,
): Boolean {
    val temp = File.createTempFile("route-check", ".gpx", tempDir)
    try {
        temp.writeBytes(bytes)
        return parseGpxData(temp).points.isNotEmpty()
    } finally {
        temp.delete()
    }
}
