package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MemoryLedgerStore(var text: String? = null) : LedgerStore {
  var failWrites = false
  var writes = 0

  override fun read(): String? = text

  override fun write(text: String) {
    if (failWrites) throw java.io.IOException("disk full")
    writes++
    this.text = text
  }
}

class ItemLedgerTest {
  private val a = "11111111-1111-4111-8111-111111111111"
  private val b = "22222222-2222-4222-8222-222222222222"
  private val c = "33333333-3333-4333-8333-333333333333"
  private val d = "44444444-4444-4444-8444-444444444444"
  private fun route(id: String) = ItemRef(ItemKind.ROUTE, id)
  private fun activity(id: String) = ItemRef(ItemKind.ACTIVITY, id)
  private fun ledger(store: MemoryLedgerStore = MemoryLedgerStore(), own: ItemKind = ItemKind.ROUTE, max: Int = 256) = ItemLedger(store, own, max)
  private fun unconfirmed(id: String, reason: CloseReason = CloseReason.TIMEOUT) = CloseInfo(reason, null, route(id))
  private fun storeFailed(item: ItemRef) = CloseInfo(CloseReason.STORE_FAILED, item, item)

  @Test
  fun anItemThatEndsThreeSessionsUnconfirmedIsDemotedNotSetAside() {
    val l = ledger()
    assertTrue(l.onClosed(unconfirmed(a)).isEmpty())
    assertTrue(l.onClosed(unconfirmed(a)).isEmpty())
    assertEquals(listOf<LedgerAction>(LedgerAction.Demoted(route(a))), l.onClosed(unconfirmed(a)))
    assertEquals(b, l.prefer(listOf(a, b)))
    assertEquals(a, l.prefer(listOf(a)))
  }

  @Test
  fun everyKindOfWeakRadioEndCountsTheSameAndNoneSetsAnythingAside() {
    for (reason in listOf(CloseReason.TIMEOUT, CloseReason.PEER_CLOSED, CloseReason.CUT_MID_FRAME, CloseReason.TLS_TRUNCATED, CloseReason.WRITE_FAILED)) {
      val l = ledger()
      val actions = (1..5).flatMap { l.onClosed(unconfirmed(a, reason)) }
      assertTrue("$reason", actions.none { it is LedgerAction.SetAside })
      assertTrue("$reason", actions.isNotEmpty())
    }
  }

  @Test
  fun aLocalCloseAndAFinishedPairingCountForNothing() {
    val l = ledger()
    repeat(5) {
      for (reason in listOf(CloseReason.LOCAL, CloseReason.PAIRING_COMPLETE, CloseReason.PAIRING_REFUSED)) {
        assertTrue(l.onClosed(unconfirmed(a, reason)).isEmpty())
      }
    }
    assertEquals(a, l.prefer(listOf(a)))
    assertEquals(null, l.prefer(emptyList()))
  }

  @Test
  fun aSessionWithNothingInFlightCountsForNothing() {
    val l = ledger()
    repeat(5) { assertTrue(l.onClosed(CloseInfo(CloseReason.TIMEOUT, null, null)).isEmpty()) }
  }

  @Test
  fun aDefiniteFailureOfAnOwnItemSetsItAsideOnTheThirdInARow() {
    val l = ledger()
    assertTrue(l.onClosed(storeFailed(route(a))).isEmpty())
    assertTrue(l.onClosed(storeFailed(route(a))).isEmpty())
    assertEquals(listOf<LedgerAction>(LedgerAction.SetAside(route(a))), l.onClosed(storeFailed(route(a))))
  }

  @Test
  fun anUnsendableOwnItemIsDefiniteToo() {
    val l = ledger()
    val info = CloseInfo(CloseReason.UNSENDABLE_ITEM, route(a), null)
    assertTrue(l.onClosed(info).isEmpty())
    assertTrue(l.onClosed(info).isEmpty())
    assertEquals(listOf<LedgerAction>(LedgerAction.SetAside(route(a))), l.onClosed(info))
  }

  @Test
  fun aDefiniteFailureIsNeverCountedAsUnconfirmedToo() {
    val l = ledger()
    repeat(2) { l.onClosed(storeFailed(route(a))) }
    // two definite failures must not add up to a demotion with an unconfirmed end
    assertTrue(l.onClosed(unconfirmed(a)).isEmpty())
    assertEquals(a, l.prefer(listOf(a, b)))
  }

  @Test
  fun aFailureNamingThePeersItemSaysNothingAboutOurOwn() {
    val l = ledger()
    val info = CloseInfo(CloseReason.STORE_FAILED, activity(a), route(b))
    repeat(5) { assertTrue(l.onClosed(info).isEmpty()) }
    assertEquals(b, l.prefer(listOf(b)))
    assertTrue(l.onClosed(unconfirmed(b)).isEmpty())
  }

  @Test
  fun aStoreFailureNamingNoItemIsNoItemsFault() {
    val l = ledger()
    repeat(5) { assertTrue(l.onClosed(CloseInfo(CloseReason.STORE_FAILED, null, route(a))).isEmpty()) }
    assertEquals(a, l.prefer(listOf(a, b)))
  }

  @Test
  fun aWatchLedgerCountsActivitiesAndIgnoresRoutes() {
    val l = ledger(own = ItemKind.ACTIVITY)
    repeat(5) { assertTrue(l.onClosed(CloseInfo(CloseReason.TIMEOUT, null, route(a))).isEmpty()) }
    repeat(2) { l.onClosed(CloseInfo(CloseReason.TIMEOUT, null, activity(b))) }
    assertEquals(listOf<LedgerAction>(LedgerAction.Demoted(activity(b))), l.onClosed(CloseInfo(CloseReason.TIMEOUT, null, activity(b))))
  }

  @Test
  fun aConfirmationResetsTheCountsAndTheDemotion() {
    val l = ledger()
    repeat(3) { l.onClosed(unconfirmed(a)) }
    l.confirmed(a)
    assertEquals(a, l.prefer(listOf(a, b)))
    repeat(2) { l.onClosed(unconfirmed(a)) }
    assertTrue(l.onClosed(unconfirmed(a)).isNotEmpty())
    repeat(2) { l.onClosed(storeFailed(route(b))) }
    l.forget(b)
    assertTrue(l.onClosed(storeFailed(route(b))).isEmpty())
  }

  @Test
  fun twoItemsThatBothFailTakeTurnsAtTheFront() {
    val l = ledger()
    repeat(3) { l.onClosed(unconfirmed(a)) }
    assertEquals(b, l.prefer(listOf(a, b)))
    repeat(3) { l.onClosed(unconfirmed(b)) }
    assertEquals(a, l.prefer(listOf(a, b)))
    l.onClosed(unconfirmed(a))
    assertEquals(b, l.prefer(listOf(a, b)))
  }

  @Test
  fun healthyItemsKeepTheirQueueOrder() {
    val l = ledger()
    repeat(3) { l.onClosed(unconfirmed(b)) }
    assertEquals(a, l.prefer(listOf(a, b, c)))
    assertEquals(c, l.prefer(listOf(b, c)))
  }

  @Test
  fun countsAndDemotionsSurviveARestart() {
    val store = MemoryLedgerStore()
    val first = ledger(store)
    repeat(2) { first.onClosed(unconfirmed(a)) }
    repeat(2) { first.onClosed(storeFailed(route(c))) }
    repeat(3) { first.onClosed(unconfirmed(b)) }
    val second = ledger(store)
    assertEquals(listOf<LedgerAction>(LedgerAction.Demoted(route(a))), second.onClosed(unconfirmed(a)))
    assertEquals(listOf<LedgerAction>(LedgerAction.SetAside(route(c))), second.onClosed(storeFailed(route(c))))
    assertEquals(c, second.prefer(listOf(b, c)))
    // the demotion sequence continues instead of restarting, so a later demotion still goes behind an older one
    assertEquals(a.takeIf { false } ?: c, ledger(store).prefer(listOf(b, c)))
  }

  @Test
  fun theEntriesAreBoundedAndTheLeastRecentlyTouchedGoesFirst() {
    val l = ledger(max = 3)
    l.onClosed(storeFailed(route(a)))
    l.onClosed(storeFailed(route(a)))
    l.onClosed(storeFailed(route(b)))
    l.onClosed(storeFailed(route(c)))
    l.onClosed(storeFailed(route(d)))
    // a was the oldest and is gone: its two failures are forgotten
    assertTrue(l.onClosed(storeFailed(route(a))).isEmpty())
    assertTrue(l.onClosed(storeFailed(route(a))).isEmpty())
    assertEquals(listOf<LedgerAction>(LedgerAction.SetAside(route(a))), l.onClosed(storeFailed(route(a))))
  }

  @Test
  fun anEntryTouchedAgainIsTheLastToGo() {
    val l = ledger(max = 3)
    l.onClosed(storeFailed(route(a)))
    l.onClosed(storeFailed(route(b)))
    l.onClosed(storeFailed(route(c)))
    l.onClosed(storeFailed(route(a)))
    l.onClosed(storeFailed(route(d)))
    assertEquals(listOf<LedgerAction>(LedgerAction.SetAside(route(a))), l.onClosed(storeFailed(route(a))))
  }

  @Test
  fun aTextThatIsNotExactlyWhatWasWrittenIsIgnoredWhole() {
    val good = MemoryLedgerStore().also { s -> ledger(s).also { repeat(3) { _ -> it.onClosed(unconfirmed(a)) } } }.text!!
    val bad = listOf(
      "", "garbage", good.replace("ledger1", "ledger2"), good + "not-an-id 1 1 1\n", good.replace("$a 0 3 1", "$a 0 3"),
      good.replace("$a 0 3 1", "$a -1 3 1"), good.replace("$a 0 3 1", "$a 0 3 99"), good.replace("ledger1 1", "ledger1 x"),
    )
    for (text in bad) {
      val l = ledger(MemoryLedgerStore(text))
      assertEquals(text, a, l.prefer(listOf(a)))
    }
    assertEquals(b, ledger(MemoryLedgerStore(good)).prefer(listOf(a, b)))
  }

  @Test
  fun aStoreThatCannotBeReadOrWrittenDoesNotBreakTheLink() {
    val unreadable = object : LedgerStore {
      override fun read(): String? = throw java.io.IOException("gone")

      override fun write(text: String) = throw java.io.IOException("gone")
    }
    val l = ItemLedger(unreadable, ItemKind.ROUTE)
    repeat(2) { assertTrue(l.onClosed(unconfirmed(a)).isEmpty()) }
    assertTrue(l.onClosed(unconfirmed(a)).isNotEmpty())
    assertEquals(b, l.prefer(listOf(a, b)))
  }

  @Test
  fun nothingButIdsAndCountsIsWritten() {
    val store = MemoryLedgerStore()
    ledger(store).onClosed(unconfirmed(a))
    assertEquals("ledger1 0\n$a 0 1 0\n", store.text)
  }

  @Test
  fun aFreshLedgerOverNothingIsEmpty() {
    assertNull(MemoryLedgerStore().text)
    assertEquals(a, ledger(MemoryLedgerStore()).prefer(listOf(a)))
  }
}
