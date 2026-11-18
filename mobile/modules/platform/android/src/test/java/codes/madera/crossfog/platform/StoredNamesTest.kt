package codes.madera.crossfog.platform

import org.junit.Assert.assertEquals
import org.junit.Test

class StoredNamesTest {
  @Test
  fun keystoreAliasesKeepTheirValues() {
    assertEquals("crossfog.kek.v1", Keys.KEK_ALIAS)
    assertEquals("crossfog.staging.v1", Keys.STAGING_ALIAS)
  }

  @Test
  fun directoriesAndFilesKeepTheirValues() {
    assertEquals("SQLite", StoredNames.SQLITE_DIR)
    assertEquals("keys", StoredNames.KEY_DIR)
    assertEquals("db.key.v1", StoredNames.DATABASE_KEY_FILE)
    assertEquals("staging", StoredNames.STAGING_DIR)
    assertEquals("outbox", StoredNames.OUTBOX_DIR)
  }
}
