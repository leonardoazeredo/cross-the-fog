package codes.madera.crossfog.watchlink

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

class CopyResult(val size: Long, val head: ByteArray)

/**
 * Streams between app-private files and documents the user picked; nothing backup-sized is held in memory.
 * The seams exist for the tests: the default source length, document delete and report are the real ones.
 */
class SaveAs(
  private val resolver: ContentResolver,
  cacheDir: File,
  private val lengthOf: (File) -> Long = { it.length() },
  private val deleteDocument: (Uri) -> Unit = { deleteAt(resolver, it) },
  private val report: (String) -> Unit = { Log.w(TAG, it) },
) {
  private val cacheRoot = cacheDir.canonicalFile

  /**
   * Copies a cache file into the document at `uri` and returns the bytes written. Anything that goes wrong,
   * including a copy whose byte count is not the source's length, deletes the document and rethrows.
   */
  fun copyToUri(sourcePath: String, uri: Uri): Long {
    try {
      val source = inCache(sourcePath)
      val expected = lengthOf(source)
      val sink = resolver.openOutputStream(uri, "w") ?: throw IOException("cannot open the document")
      val written = sink.use { out -> source.inputStream().use { input -> copy(input, out).size } }
      if (written != expected) throw IOException("the copy is not the size of the source")
      return written
    } catch (e: Exception) {
      // The picker has already created the document, so a failure at any point, even before the first
      // byte, would leave an empty or half-written one in the user's folder.
      deleteQuietly(uri)
      throw e
    }
  }

  /** Copies the document at `uri` into a cache file and returns its size and first bytes; a failed copy deletes the file. */
  fun copyFromUri(uri: Uri, destPath: String): CopyResult {
    val dest = inCache(destPath)
    val input = resolver.openInputStream(uri) ?: throw IOException("cannot open the document")
    try {
      return input.use { source -> dest.outputStream().use { sink -> copy(source, sink) } }
    } catch (e: Exception) {
      dest.delete()
      throw e
    }
  }

  /** The provider's display name for the document, or null when it gives none; a file: URI returns its last path segment. */
  fun displayName(uri: Uri): String? {
    if (uri.scheme == "file") return uri.lastPathSegment
    return resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
      if (it.moveToFirst()) it.getString(0) else null
    }
  }

  // JS hands over paths, so one outside the cache directory is refused rather than trusted.
  private fun inCache(path: String): File {
    val file = File(Uri.parse(path).path ?: path).canonicalFile
    require(file.path.startsWith(cacheRoot.path + File.separator)) { "path is outside the cache directory" }
    return file
  }

  // The copy's own failure is what the caller needs, so a delete that fails is only reported, by class: a
  // message or path could name the user's folder.
  private fun deleteQuietly(uri: Uri) {
    try {
      deleteDocument(uri)
    } catch (e: Exception) {
      report("could not delete a document left by a failed save: ${e.javaClass.simpleName}")
    }
  }

  internal companion object {
    private const val TAG = "SaveAs"
    private fun deleteAt(resolver: ContentResolver, uri: Uri) {
      if (uri.scheme == "file") {
        val file = File(uri.path ?: return)
        if (!file.delete() && file.exists()) throw IOException("the document is still there")
      } else {
        // Older Android versions and providers answer false instead of throwing.
        if (!DocumentsContract.deleteDocument(resolver, uri)) throw IOException("the document is still there")
      }
    }

    private const val BUFFER_BYTES = 1024 * 1024
    private const val HEAD_BYTES = 16

    fun copy(input: InputStream, output: OutputStream): CopyResult {
      val buffer = ByteArray(BUFFER_BYTES)
      val head = ByteArray(HEAD_BYTES)
      var size = 0L
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        if (size < HEAD_BYTES) buffer.copyInto(head, size.toInt(), 0, minOf(n, HEAD_BYTES - size.toInt()))
        output.write(buffer, 0, n)
        size += n
      }
      return CopyResult(size, head.copyOf(minOf(size, HEAD_BYTES.toLong()).toInt()))
    }
  }
}
