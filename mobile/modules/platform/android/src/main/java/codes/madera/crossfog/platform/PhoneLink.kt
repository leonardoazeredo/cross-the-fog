package codes.madera.crossfog.platform

import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import java.io.File

/**
 * The phone's half of the link over its stores, built once per process: what the page asks of it
 * ([state]), the route queue and the activity sink a transport session will use ([routes], [sink]),
 * and the session's close handler ([events]). [emit] carries a named event to the page, and no event
 * holds more than the ids and the revision the page already knows.
 */
internal class PhoneLink(
  staging: StagingStore,
  outbox: StagingStore,
  linkDir: File,
  syncDir: (File) -> Unit,
  identityPresent: () -> Boolean,
  emit: (name: String, payload: Map<String, Any?>) -> Unit,
) {
  private val ledger = ItemLedger(FileLedgerStore(linkDir, syncDir), ItemKind.ROUTE)

  val state = LinkState(FilePinStore(linkDir, syncDir), identityPresent, onChange = { status ->
    emit("linkStatus", mapOf("paired" to status.paired, "reachable" to status.reachable))
  })

  val routes = OutboxRoutes(outbox, ledger) { id, revision ->
    emit("routeSaved", mapOf("routeId" to id, "revision" to revision))
  }

  val sink = StagingSink(staging) { id -> emit("activityStaged", mapOf("activityId" to id)) }

  val events = LedgerEvents(ledger, routes) { id, revision ->
    emit("routeSetAside", buildMap { put("routeId", id); if (revision != null) put("revision", revision) })
  }
}
