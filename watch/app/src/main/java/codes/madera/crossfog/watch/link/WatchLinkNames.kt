package codes.madera.crossfog.watch.link

/** Names the link keeps on disk and in the Keystore. A rename would orphan what a watch already holds, so a test pins each. */
internal object WatchLinkNames {
    const val OUTBOX_DIR = "outbox"
    const val ASIDE_DIR = "aside"
    const val LINK_DIR = "link"
    const val PIN_FILE = "pin.v1"
    const val LEDGER_FILE = "ledger.v1"
    const val IDENTITY_ALIAS = "crossfog.link.watch.v1"
    const val ROUTES_PREFS = "link_routes"
    const val ROUTE_FILE_PREFIX = "route-"
}
