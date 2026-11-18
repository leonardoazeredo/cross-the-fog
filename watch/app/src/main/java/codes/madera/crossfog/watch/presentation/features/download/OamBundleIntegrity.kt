package codes.madera.crossfog.watch.presentation.features.download

import android.content.res.Resources
import codes.madera.crossfog.watch.R
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

// Keep every existing validation guard and its typed, localizable failure.
@Suppress("ThrowsCount")
internal fun validateGzipDemStructure(
    file: File,
    resources: Resources,
) {
    if (!file.exists() || !file.isFile || file.length() < GZIP_MINIMUM_BYTES) {
        throw IOException(resources.getString(R.string.download_dem_tile_is_missing_empty_or_truncated))
    }
    RandomAccessFile(file, "r").use { input ->
        if (input.readUnsignedByte() != GZIP_MAGIC_FIRST || input.readUnsignedByte() != GZIP_MAGIC_SECOND) {
            throw IOException(resources.getString(R.string.download_dem_tile_has_an_invalid_gzip_header))
        }
        input.seek(file.length() - Int.SIZE_BYTES)
        val sizeBytes = ByteArray(Int.SIZE_BYTES)
        input.readFully(sizeBytes)
        val uncompressedSize =
            ByteBuffer
                .wrap(sizeBytes)
                .order(ByteOrder.LITTLE_ENDIAN)
                .int
                .toLong() and 0xFFFFFFFFL
        if (!isPlausibleHgtByteSize(uncompressedSize)) {
            throw IOException(resources.getString(R.string.download_dem_tile_has_an_invalid_uncompressed_size))
        }
    }
}

private fun isPlausibleHgtByteSize(size: Long): Boolean {
    if (size <= 0L || size % Short.SIZE_BYTES != 0L) return false
    val sampleCount = size / Short.SIZE_BYTES
    val rowLength = sqrt(sampleCount.toDouble()).toInt()
    return rowLength * rowLength.toLong() == sampleCount && rowLength in 1201..3601
}

private const val GZIP_MINIMUM_BYTES = 18L
private const val GZIP_MAGIC_FIRST = 0x1F
private const val GZIP_MAGIC_SECOND = 0x8B
