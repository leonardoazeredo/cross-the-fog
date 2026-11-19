package codes.madera.crossfog.platform

/**
 * Names of what an installed app keeps on the phone. An upgrade finds its data again only under
 * these exact names, so a rename of a package or a class must not touch them; `StoredNamesTest`
 * pins every value.
 */
internal object StoredNames {
  const val SQLITE_DIR = "SQLite"
  const val KEY_DIR = "keys"
  const val DATABASE_KEY_FILE = "db.key.v1"
  const val STAGING_DIR = "staging"
  const val OUTBOX_DIR = "outbox"
  const val ASIDE_DIR = "aside"
  const val LINK_DIR = "link"
  const val LINK_PIN_FILE = "pin.v1"
  const val LINK_LEDGER_FILE = "ledger.v1"
}
