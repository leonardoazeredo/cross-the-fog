package codes.madera.crossfog.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class PairMessagesTest {
  private val proof = "0123456789abcdef".repeat(4)

  private fun roundTrip(message: Message) = Messages.parse(Messages.encode(message))

  @Test
  fun everyPairingMessageSurvivesTheWire() {
    val all = listOf(PairRequest(proof), PairAccepted, PairConfirm, PairDone) + PairRejection.entries.map { PairRejected(it) }
    for (m in all) assertEquals(m, roundTrip(m))
  }

  @Test
  fun theWireNamesOfTheRejectionsAreFixed() {
    assertEquals(listOf("wrong_code", "code_used", "expired", "too_many_tries"), PairRejection.entries.map { it.wire })
  }

  @Test
  fun aProofMustBeSixtyFourLowercaseHexDigits() {
    for (bad in listOf("", proof.uppercase(), proof.dropLast(1), proof + "0", "g" + proof.drop(1))) {
      assertThrows(ProtocolException::class.java) { PairRequest(bad) }
    }
  }

  @Test
  fun aRejectionNeedsOneOfTheFixedReasons() {
    for (body in listOf("""{"v":1,"type":"pairRejected"}""", """{"v":1,"type":"pairRejected","reason":"nope"}""", """{"v":1,"type":"pairRejected","reason":7}""")) {
      assertEquals(ProtocolError.FIELD_MISSING_OR_INVALID, assertThrows(ProtocolException::class.java) { Messages.parse(body.toByteArray()) }.error)
    }
  }

  @Test
  fun theProofNeverAppearsInToString() {
    assertFalse(PairRequest(proof).toString().contains(proof))
    assertEquals("PairRequest", PairRequest(proof).toString())
  }
}
