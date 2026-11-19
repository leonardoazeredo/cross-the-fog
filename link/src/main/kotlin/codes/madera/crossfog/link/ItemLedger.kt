package codes.madera.crossfog.link

/**
 * Where an [ItemLedger] keeps its counts between runs of the app. [write] must replace the text in
 * one step (a failure leaves the old text), and [read] returns null when nothing was written.
 */
interface LedgerStore {
  fun read(): String?

  fun write(text: String)
}

/** What the app does about an item the ledger has given up on or pushed back. */
sealed interface LedgerAction {
  /** A definite local failure [ItemLedger]'s threshold times with no confirmation between: take the item out of the queue (never delete it) and tell the user. */
  data class SetAside(val item: ItemRef) : LedgerAction

  /** The item ended [ItemLedger]'s threshold times or more unconfirmed, with no confirmation between: [ItemLedger.prefer] now offers it after the others. */
  data class Demoted(val item: ItemRef) : LedgerAction
}

/**
 * Keeps one app's queue moving past an item that fails every session, without parking an item a weak
 * radio merely interrupted. It counts per item, ids only, bounded to [maxEntries] (the least recently
 * touched entry goes first), and survives a restart through its [LedgerStore].
 *
 * - **Definite local failures** ([CloseReason.STORE_FAILED], [CloseReason.UNSENDABLE_ITEM] naming an item of
 *   this app's own queue): after [threshold] times with no confirmation between the ledger answers [LedgerAction.SetAside].
 * - **Unconfirmed ends** (an end other than a local close or a finished pairing, with an own item in flight; a dropped link causes one just as well):
 *   after [threshold] times with no confirmation between the item is [LedgerAction.Demoted], and [prefer] offers every other
 *   item first. Each further unconfirmed end demotes it again, so two items that both fail take turns
 *   instead of the older one starving the other. Nothing is parked.
 *
 * A count resets through [confirmed] or [forget], or when its entry is evicted past [maxEntries]. A session that ends because of the peer's item
 * (a failure that names an item of the other kind) says nothing about this app's own items and is not counted.
 */
class ItemLedger(
  private val store: LedgerStore,
  private val own: ItemKind,
  private val maxEntries: Int = 256,
  private val threshold: Int = 3,
) {
  private class Entry(var definite: Int, var unconfirmed: Int, var demotedAt: Long)

  // Insertion order is the order of last touch: an entry is removed and put back when it changes.
  private val entries = LinkedHashMap<String, Entry>()
  private var sequence = 0L

  init {
    require(maxEntries > 0 && threshold > 0) { "bad limits" }
    load()
  }

  fun onClosed(info: CloseInfo): List<LedgerAction> {
    if (info.reason == CloseReason.LOCAL || info.reason == CloseReason.PAIRING_COMPLETE || info.reason == CloseReason.PAIRING_REFUSED) {
      return emptyList()
    }
    val failed = info.failed
    val definite = info.reason == CloseReason.STORE_FAILED || info.reason == CloseReason.UNSENDABLE_ITEM
    if (definite && failed != null) {
      if (failed.kind != own) return emptyList()
      val e = touch(failed.id)
      e.definite++
      save()
      return if (e.definite >= threshold) listOf(LedgerAction.SetAside(failed)) else emptyList()
    }
    // A store failure with no item named (a queue read that threw) is no item's fault either.
    if (definite) return emptyList()
    val flying = info.inFlight ?: return emptyList()
    if (flying.kind != own) return emptyList()
    val e = touch(flying.id)
    e.unconfirmed++
    val demoted = e.unconfirmed >= threshold
    if (demoted) e.demotedAt = ++sequence
    save()
    return if (demoted) listOf(LedgerAction.Demoted(flying)) else emptyList()
  }

  /** The item was confirmed by the peer: its counts and any demotion are gone. */
  fun confirmed(id: String) = forget(id)

  /** The item left the queue for any reason (confirmed, deleted, set aside). */
  fun forget(id: String) {
    if (entries.remove(id) != null) save()
  }

  /**
   * Which of the queued ids to offer next: [queued] is in queue order, oldest first. The first one that
   * was never demoted; when every queued item is demoted, the one demoted longest ago. Null for an empty queue.
   */
  fun prefer(queued: List<String>): String? {
    var best: String? = null
    var bestAt = Long.MAX_VALUE
    for (id in queued) {
      val at = entries[id]?.demotedAt ?: 0L
      if (at == 0L) return id
      if (at < bestAt) {
        best = id
        bestAt = at
      }
    }
    return best
  }

  private fun touch(id: String): Entry {
    val e = entries.remove(id) ?: Entry(0, 0, 0)
    entries[id] = e
    while (entries.size > maxEntries) entries.remove(entries.keys.first())
    return e
  }

  private fun save() {
    val text = buildString {
      append("ledger1 ").append(sequence).append('\n')
      for ((id, e) in entries) append(id).append(' ').append(e.definite).append(' ').append(e.unconfirmed).append(' ').append(e.demotedAt).append('\n')
    }
    try {
      store.write(text)
    } catch (e: Exception) {
      // The counts stay in memory for this run; a ledger that cannot be written must not stop the link
      // (and an item that fails every session would otherwise block the queue because the ledger broke).
    }
  }

  /** A text with a bad header, a non-UUID id, a field that is not a number or is negative, or a demotion stamp past the header's sequence is ignored whole: the ledger starts empty rather than guess. */
  private fun load() {
    val text = try {
      store.read()
    } catch (e: Exception) {
      null
    } ?: return
    val lines = text.split('\n')
    val head = lines.firstOrNull()?.split(' ') ?: return
    if (head.size != 2 || head[0] != "ledger1") return
    val seq = head[1].toLongOrNull()?.takeIf { it >= 0 } ?: return
    val loaded = LinkedHashMap<String, Entry>()
    for (line in lines.drop(1)) {
      if (line.isEmpty()) continue
      val f = line.split(' ')
      if (f.size != 4 || !Ids.UUID.matches(f[0])) return
      val d = f[1].toIntOrNull()
      val u = f[2].toIntOrNull()
      val at = f[3].toLongOrNull()
      if (d == null || u == null || at == null || d < 0 || u < 0 || at < 0 || at > seq) return
      loaded[f[0]] = Entry(d, u, at)
    }
    while (loaded.size > maxEntries) loaded.remove(loaded.keys.first())
    sequence = seq
    entries.putAll(loaded)
  }
}
