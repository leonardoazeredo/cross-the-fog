package codes.madera.crossfog.platform

import java.io.IOException
import java.security.GeneralSecurityException

/**
 * Removes the outbox routes that can never be opened and returns how many it removed. A route is lost
 * when it fails to authenticate (every one sealed before a lost staging alias does), does not parse,
 * does not match its file name or cannot be read from disk (an oversized or unreadable file); the page
 * tells the user to send it again, which a stuck file would only fail on at every drain.
 *
 * An unusable staging entry (`UnrecoverableKeyException`, `KeyPermanentlyInvalidatedException`) is not
 * a lost alias: nothing can be read, so no route is known to be lost, and the call keeps every file
 * and counts nothing. Any other Keystore failure propagates.
 */
internal fun discardUnreadableRoutes(
  open: () -> StagingStore,
  report: (String) -> Unit,
): Int {
  val store = try {
    open()
  } catch (e: GeneralSecurityException) {
    if (!isUnusableKey(e)) throw e
    return 0
  }
  return discardUnreadableRoutes(store.list(), store::read, store::release, report)
}

internal fun discardUnreadableRoutes(
  ids: List<String>,
  read: (String) -> ByteArray?,
  release: (String) -> Unit,
  report: (String) -> Unit,
): Int {
  val lost = mutableListOf<String>()
  for (id in ids) {
    val readable = try {
      read(id)?.let { Frames.parseRouteOffer(it) }?.let { it.routeId == id }
    } catch (e: FrameException) {
      false
    } catch (e: IOException) {
      false
    } catch (e: GeneralSecurityException) {
      // The key is first used here, so an invalidated one shows mid-listing: what was judged lost
      // before it may only have been unreadable because of it, so nothing is removed.
      if (!isUnusableKey(e)) throw e
      return 0
    }
    // Null: the item is gone already, which is not a loss.
    if (readable == false) lost += id
  }
  var removed = 0
  for (id in lost) {
    try {
      release(id)
      removed++
    } catch (e: Exception) {
      // Not counted: the file is still there, so the drain that removes it counts it. Only the class
      // is reported, since a message can name the file.
      report("could not delete an unreadable outbox item: ${e.javaClass.simpleName}")
    }
  }
  return removed
}
