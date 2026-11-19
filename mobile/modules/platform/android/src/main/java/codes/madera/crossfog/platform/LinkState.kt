package codes.madera.crossfog.platform

import codes.madera.crossfog.link.PinStore
import codes.madera.crossfog.link.QrPayload

internal class LinkStatus(val paired: Boolean, val reachable: Boolean)

internal enum class PairFailureKind(val code: String, val text: String) {
  /** The text is not a pairing code this version reads. */
  INVALID_QR("ERR_INVALID_QR", "invalid pairing code"),

  /** No transport is registered, so nothing can reach a watch. */
  NO_TRANSPORT("ERR_NO_TRANSPORT", "no transport"),
}

/** The message is fixed text: the code it refuses holds a secret and is never repeated. */
internal class PairException(val kind: PairFailureKind) : Exception(kind.text)

internal fun pairCallFailure(e: Exception): Failure? =
  if (e is PairException) Failure(e.kind.code, e.kind.text) else null

/**
 * What the page can ask of the link today. [transport] carries a scanned code to the watch; none is
 * registered until a radio adapter exists, so [pair] refuses with [PairFailureKind.NO_TRANSPORT] and
 * [status] reports nothing reachable. "Paired" is a pin together with the Keystore key it was paired for.
 */
internal class LinkState(
  private val pins: PinStore,
  private val identityPresent: () -> Boolean = { true },
  private val transport: ((QrPayload) -> Unit)? = null,
) {
  fun status(): LinkStatus {
    // A pin store that cannot be read is no proof of a pairing.
    val pinned = try {
      pins.get() != null
    } catch (e: Exception) {
      false
    }
    if (!pinned) return LinkStatus(paired = false, reachable = false)
    // The watch trusts this phone's key, and with that key gone (a lost Keystore entry) no session can
    // be made, so the pin is a pairing in name only: clear it. A Keystore that cannot answer says nothing about the key.
    val present = try {
      identityPresent()
    } catch (e: Exception) {
      return LinkStatus(paired = false, reachable = false)
    }
    if (!present) {
      try {
        pins.clear()
      } catch (e: Exception) {
        // The next status asks again.
      }
      return LinkStatus(paired = false, reachable = false)
    }
    return LinkStatus(paired = true, reachable = false)
  }

  fun pair(qr: String) {
    val payload = QrPayload.parse(qr) ?: throw PairException(PairFailureKind.INVALID_QR)
    val send = transport ?: throw PairException(PairFailureKind.NO_TRANSPORT)
    send(payload)
  }

  fun unpair() = pins.clear()
}
