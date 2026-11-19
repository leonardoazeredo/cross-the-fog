package codes.madera.crossfog.link

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** A pairing that fails or drops must leave a working pairing working; a new pin is written only at its commit point. */
class RepairTest {
  private val phoneHash = TestKeys.phone.spkiHash()
  private val watchHash = TestKeys.watch.spkiHash()

  private fun repair(cutAfter: Pair<Boolean, String>?, watchPins: MemoryPins, phonePins: MemoryPins, phoneId: Identity = TestKeys.phone): PairRig {
    val p = PairRig(watchPins = watchPins, phonePins = phonePins, cutAfter = cutAfter, phoneId = phoneId)
    p.rig.run()
    return p
  }

  private fun oldPairingStillWorks(watchPins: MemoryPins, phonePins: MemoryPins) {
    val n = NormalRig(phonePins = phonePins, watchPins = watchPins)
    val offer = route(ROUTE_A)
    n.phoneRoutes.queue(offer)
    n.rig.run()
    assertEquals(setOf(ROUTE_A), n.watchRoutes.saved.keys)
  }

  private fun dropAt(side: Boolean, message: String, watchWrites: Int, phoneWrites: Int) {
    val watchPins = MemoryPins(phoneHash)
    val phonePins = MemoryPins(watchHash)
    val p = repair(side to message, watchPins, phonePins)
    assertTrue("session ended without pairing", CloseReason.PAIRING_COMPLETE !in p.phone.events.closed)
    assertEquals("watch pin writes after a drop following $message", watchWrites, watchPins.puts)
    assertEquals("phone pin writes after a drop following $message", phoneWrites, phonePins.puts)
    assertArrayEquals(phoneHash, watchPins.get())
    assertArrayEquals(watchHash, phonePins.get())
    oldPairingStillWorks(watchPins, phonePins)
  }

  @Test
  fun aDropRightAfterThePhonesHelloLeavesTheOldPairingWorking() = dropAt(false, "Hello", 0, 0)

  @Test
  fun aDropAfterTheWatchsHelloLeavesTheOldPairingWorking() = dropAt(true, "Hello", 0, 0)

  @Test
  fun aWatchWithANewKeyThatDropsBeforeTheCommitLeavesThePhoneOnTheOldWatch() {
    val watchPins = MemoryPins(phoneHash)
    val phonePins = MemoryPins(watchHash)
    val p = PairRig(watchPins = watchPins, phonePins = phonePins, watchId = TestKeys.attacker, cutAfter = false to "PairConfirm")
    p.rig.run()
    assertEquals(0, phonePins.puts)
    assertArrayEquals(watchHash, phonePins.get())
    assertTrue(!watchHash.contentEquals(TestKeys.attacker.spkiHash()))
    oldPairingStillWorks(watchPins, phonePins)
  }

  @Test
  fun aDropAfterTheRequestLeavesTheOldPairingWorking() = dropAt(false, "PairRequest", 0, 0)

  @Test
  fun aDropAfterTheWatchAcceptedLeavesTheOldPairingWorking() = dropAt(true, "PairAccepted", 0, 0)

  @Test
  fun aDropAfterThePhoneConfirmedLeavesTheOldPairingWorkingBeforeTheWatchCommits() = dropAt(false, "PairConfirm", 0, 0)

  @Test
  fun aDropAfterTheWatchCommittedLeavesThePhoneWithItsOldPinAndTheWatchWithTheNewOne() = dropAt(true, "PairDone", 1, 0)

  @Test
  fun aRefusedRePairLeavesTheOldPinsAlone() {
    val watchPins = MemoryPins(phoneHash)
    val phonePins = MemoryPins(watchHash)
    val bad = QrPayload(watchHash, ByteArray(16) { 3 }, "rfcomm")
    val p = PairRig(watchPins = watchPins, phonePins = phonePins, qr = bad)
    p.rig.run()
    assertEquals(PairRejection.WRONG_CODE, p.phoneEndpoint.rejection)
    assertEquals(0, watchPins.puts + phonePins.puts)
    oldPairingStillWorks(watchPins, phonePins)
  }

  @Test
  fun theWatchWritesItsPinOnlyWhenThePhoneConfirmsAndThePhoneOnlyWhenTheWatchIsDone() {
    val watchPins = MemoryPins()
    val phonePins = MemoryPins()
    val p = PairRig(watchPins = watchPins, phonePins = phonePins)
    p.rig.run()
    assertEquals(1, watchPins.puts)
    assertEquals(1, phonePins.puts)
  }

  @Test
  fun aNewPhoneKeyWhoseRePairDropsAfterTheWatchCommittedIsTheOneWindowAndRePairingClosesIt() {
    val watchPins = MemoryPins(phoneHash)
    val phonePins = MemoryPins(watchHash)
    repair(true to "PairDone", watchPins, phonePins, phoneId = TestKeys.attacker)
    assertArrayEquals(TestKeys.attacker.spkiHash(), watchPins.get())
    assertArrayEquals(watchHash, phonePins.get())
    val again = PairRig(watchPins = watchPins, phonePins = phonePins, phoneId = TestKeys.attacker)
    again.rig.run()
    assertEquals(CloseReason.PAIRING_COMPLETE, again.phone.events.closed.single())
  }

  @Test
  fun rePairingReplacesThePins() {
    val watchPins = MemoryPins(TestKeys.attacker.spkiHash())
    val phonePins = MemoryPins(TestKeys.attacker.spkiHash())
    PairRig(watchPins = watchPins, phonePins = phonePins).rig.run()
    assertArrayEquals(phoneHash, watchPins.get())
    assertArrayEquals(watchHash, phonePins.get())
  }

  @Test
  fun afterUnpairingANormalSessionFailsOnBothSides() {
    val watchPins = MemoryPins(phoneHash)
    val phonePins = MemoryPins(watchHash)
    phonePins.clear()
    val n = NormalRig(phonePins = phonePins, watchPins = watchPins)
    n.rig.run()
    assertEquals(false, n.phone.secured)
    assertEquals(0, n.phone.plainBytes)
    watchPins.clear()
    phonePins.put(watchHash)
    val m = NormalRig(phonePins = phonePins, watchPins = watchPins)
    m.rig.run()
    assertEquals(false, m.watch.secured)
    assertEquals(null, m.watch.endpoint)
  }
}
