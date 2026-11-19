package codes.madera.crossfog.watch.link

import codes.madera.crossfog.link.CloseInfo
import codes.madera.crossfog.link.CloseReason
import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemLedger
import codes.madera.crossfog.link.LedgerAction
import codes.madera.crossfog.link.LinkEvents

/**
 * Applies the item ledger when a session ends. A walk that failed here three times with nothing
 * confirmed is moved aside, never deleted, so the ones behind it are sent; a demotion only changes the
 * order [WatchOutbox] offers them in, so nothing is done for one here. A route that fails to save is
 * the phone's to resend and is not this end's to set aside.
 */
internal class WatchLinkEvents(
    private val ledger: ItemLedger,
    private val outbox: WatchOutbox,
) : LinkEvents {
    override fun ready() = Unit

    override fun closed(
        reason: CloseReason,
        itemId: String?,
    ) = Unit

    override fun closedWith(info: CloseInfo) {
        for (action in ledger.onClosed(info)) {
            if (action is LedgerAction.SetAside && action.item.kind == ItemKind.ACTIVITY) outbox.setAside(action.item.id)
        }
    }
}
