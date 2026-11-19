package codes.madera.crossfog.platform

import android.util.Log
import android.net.Uri
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class PlatformModule : Module() {
  private val context by lazy {
    appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "no Android context", null)
  }
  private val keys by lazy { Keys(context) }

  // Both stores live in noBackupFilesDir for the same reason as the database key: a restored copy
  // would be undecryptable.
  private val stagingDir by lazy { File(context.noBackupFilesDir, StoredNames.STAGING_DIR) }
  private val outboxDir by lazy { File(context.noBackupFilesDir, StoredNames.OUTBOX_DIR) }
  private val stagingKey by lazy { keys.stagingKey(listOf(stagingDir, outboxDir)) }
  // One instance per directory for the process, so a transport service writing these directories
  // shares the module's lock instead of racing it.
  private val staging by lazy { processStagingStores.forDir(stagingDir, { stagingKey }, ::fsyncDirectory) }
  private val outbox by lazy { processStagingStores.forDir(outboxDir, { stagingKey }, ::fsyncDirectory) }

  private val link by lazy {
    // sendEvent is a no-op while no JS runtime is attached; JS then finds the item through the stores on start.
    PhoneLink(staging, outbox, File(context.noBackupFilesDir, StoredNames.LINK_DIR), ::fsyncDirectory, KeystoreIdentity::exists) { name, payload ->
      sendEvent(name, payload)
    }
  }

  private val saveAs by lazy { SaveAs(context.contentResolver, context.cacheDir) }
  private lateinit var createLauncher: AppContextActivityResultLauncher<CreateInput, Uri?>

  override fun definition() = ModuleDefinition {
    Name("Platform")

    Events("activityStaged", "linkStatus", "routeSaved", "routeSetAside")

    AsyncFunction("getDatabaseKeyHex") { keyCall { keys.databaseKey().toHex() } }

    // Only for a restore from the lost or unreadable state, where the old database cannot be read by
    // any key; JS calls it once the database built with this key is in place.
    AsyncFunction("replaceLostDatabaseKey") { keyHex: String ->
      keyCall {
        val dek = databaseKeyFromHex(keyHex)
        try {
          keys.replaceLostDatabaseKey(dek)
        } finally {
          dek.fill(0)
        }
      }
    }

    // Only when no database file exists and the key is lost or unreadable (or already fresh, which
    // drops nothing that works); Keys refuses otherwise.
    AsyncFunction("resetKeys") { keyCall { keys.resetKeys() } }

    RegisterActivityContracts {
      createLauncher = registerForActivityResult(CreateDocumentContract())
    }

    AsyncFunction("createDocument") Coroutine { name: String, mime: String ->
      createLauncher.launch(CreateInput(name, mime))?.toString()
    }

    AsyncFunction("copyToUri") Coroutine { sourcePath: String, uri: String ->
      withContext(Dispatchers.IO) { saveAs.copyToUri(sourcePath, Uri.parse(uri)).toDouble() }
    }

    AsyncFunction("displayNameOf") Coroutine { uri: String ->
      withContext(Dispatchers.IO) { saveAs.displayName(Uri.parse(uri)) }
    }

    AsyncFunction("copyFromUri") Coroutine { uri: String, destPath: String ->
      withContext(Dispatchers.IO) {
        val r = saveAs.copyFromUri(Uri.parse(uri), destPath)
        mapOf("size" to r.size.toDouble(), "head" to r.head.toHex())
      }
    }

    AsyncFunction("keyState") { keyCall { keys.keyState().wire } }

    AsyncFunction("keyPresence") { keyCall { keys.keyPresence().wire } }

    // No watch transport is built yet, so nothing is ever reachable; "paired" needs a pin and the identity key it was made for.
    AsyncFunction("status") {
      val status = link.state.status()
      mapOf("paired" to status.paired, "reachable" to status.reachable)
    }

    // Refuses with ERR_NO_TRANSPORT until a radio adapter registers one; the code is never logged or echoed.
    AsyncFunction("pair") { qr: String -> pairCall { link.state.pair(qr) } }

    AsyncFunction("unpair") { coded { link.state.unpair() } }

    AsyncFunction("pendingActivities") {
      readStagedActivities(stagingDir) { staging }.readable.map { it.summary() }
    }

    // Counted on its own because an unreadable item is neither listed nor deleted, so without the
    // count the page would never learn it exists.
    AsyncFunction("unreadableActivities") {
      val unreadable = readStagedActivities(stagingDir) { staging }.unreadable
      // Fixed text: nothing of an item reaches the log.
      if (unreadable > 0) Log.w(TAG, "staged items that cannot be read: $unreadable")
      unreadable
    }

    // Removes the outbox routes that can never be opened (sealed before a lost staging alias) and
    // returns how many it removed, so the page can tell the user to send them again.
    AsyncFunction("discardUnreadableRoutes") {
      // Fixed text: nothing of a route reaches the log.
      val removed = discardUnreadableRoutes({ outbox }) { Log.w(TAG, it) }
      if (removed > 0) Log.w(TAG, "outbox routes that could not be opened were removed: $removed")
      removed
    }

    AsyncFunction("readActivity") { id: String ->
      val bytes = coded { staging.read(id) }
        ?: throw CodedException(NOT_FOUND, "no staged activity with that id", null)
      String(bytes, Charsets.UTF_8)
    }

    AsyncFunction("release") { id: String -> coded { staging.release(id) } }

    AsyncFunction("queueRoute") { routeJson: String ->
      coded {
        val bytes = routeJson.toByteArray(Charsets.UTF_8)
        link.routes.queue(Frames.parseRouteOffer(bytes).routeId, bytes)
      }
    }

    debugFunctions { bytes -> coded { stageActivity(bytes) } }
  }

  /** The one way an activity enters the staging store; the event follows the durable write. */
  private fun stageActivity(bytes: ByteArray) {
    link.sink.store(Frames.parseActivityOffer(bytes))
  }

  private inline fun <T> pairCall(block: () -> T): T =
    try {
      block()
    } catch (e: Exception) {
      val failure = pairCallFailure(e) ?: throw e
      throw CodedException(failure.code, failure.message, null)
    }

  private inline fun <T> keyCall(block: () -> T): T =
    try {
      block()
    } catch (e: Exception) {
      val failure = keyCallFailure(e)
      // No cause is attached: a provider exception anywhere in the chain may name the file that
      // holds the key. Keys' two exceptions are routine outcomes with fixed text, so only other
      // classes are logged, by class name alone.
      if (e !is KeyLostException && e !is KeyRefusedException) {
        Log.w(TAG, "keyCall failed: ${e.javaClass.simpleName}")
      }
      throw CodedException(failure.code, failure.message, null)
    }

  private inline fun <T> coded(block: () -> T): T =
    try {
      block()
    } catch (e: Exception) {
      val failure = stagingCallFailure(e) ?: throw e
      // No cause for a storage failure: a FileNotFoundException names the file, and so the id.
      if (failure.code == STORAGE) Log.w(TAG, "staging store failed: ${e.javaClass.simpleName}")
      throw CodedException(failure.code, failure.message, if (failure.code == STORAGE) null else e)
    }

  private companion object {
    const val TAG = "Platform"
  }
}

internal fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

// The message never repeats the text: it is key material.
internal fun databaseKeyFromHex(hex: String): ByteArray {
  require(hex.length == Keys.DATABASE_KEY_BYTES * 2 && hex.all { it in '0'..'9' || it in 'a'..'f' }) {
    "malformed database key"
  }
  return ByteArray(Keys.DATABASE_KEY_BYTES) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
}
