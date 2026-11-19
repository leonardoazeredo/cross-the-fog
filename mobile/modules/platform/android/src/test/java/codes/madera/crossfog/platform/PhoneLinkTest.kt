package codes.madera.crossfog.platform

import codes.madera.crossfog.link.ActivityOffer
import codes.madera.crossfog.link.CloseInfo
import codes.madera.crossfog.link.CloseReason
import codes.madera.crossfog.link.ItemKind
import codes.madera.crossfog.link.ItemRef
import java.io.File
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PhoneLinkTest {
  @get:Rule val tmp = TemporaryFolder()

  private val key = SecretKeySpec(ByteArray(32) { 7 }, "AES")
  private val a = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001"
  private val emitted = mutableListOf<Pair<String, Map<String, Any?>>>()
  private val stores = StagingStores()

  private fun link() = PhoneLink(
    staging = stores.forDir(File(tmp.root, "staging"), { key }, {}),
    outbox = stores.forDir(File(tmp.root, "outbox"), { key }, {}),
    linkDir = File(tmp.root, "link"),
    syncDir = {},
    identityPresent = { true },
  ) { name, payload -> emitted += name to payload }

  private fun routeJson(gpx: String = "<gpx/>") =
    """{"routeId":"$a","name":"Route","createdAt":"2026-11-16T10:00:00Z","gpx":"$gpx"}""".toByteArray()

  @Test
  fun aStagedActivityIsAnnouncedUnderItsEventName() {
    link().sink.store(ActivityOffer(a, null, "1", "<gpx/>"))
    assertEquals(listOf("activityStaged" to mapOf<String, Any?>("activityId" to a)), emitted)
  }

  @Test
  fun aDeliveredRouteIsAnnouncedWithTheRevisionTheWatchSaved() {
    val l = link()
    l.routes.queue(a, routeJson())
    val route = l.routes.nextQueued()!!
    l.routes.markDelivered(a, route.revision)
    assertEquals(listOf("routeSaved" to mapOf<String, Any?>("routeId" to a, "revision" to route.revision)), emitted)
  }

  @Test
  fun aRouteSetAsideIsAnnouncedWithItsId() {
    val l = link()
    l.routes.queue(a, routeJson())
    val revision = l.routes.nextQueued()!!.revision
    repeat(3) {
      l.events.closedWith(CloseInfo(CloseReason.STORE_FAILED, ItemRef(ItemKind.ROUTE, a), ItemRef(ItemKind.ROUTE, a)))
    }
    assertEquals(listOf("routeSetAside" to mapOf<String, Any?>("routeId" to a, "revision" to revision)), emitted)
  }

  @Test
  fun aRouteSetAsideThatCouldNotBeOpenedIsAnnouncedWithoutARevision() {
    val l = link()
    File(tmp.root, "outbox").mkdirs()
    stores.forDir(File(tmp.root, "outbox"), { key }, {}).stage(a, "not json".toByteArray())
    repeat(3) {
      l.events.closedWith(CloseInfo(CloseReason.STORE_FAILED, ItemRef(ItemKind.ROUTE, a), ItemRef(ItemKind.ROUTE, a)))
    }
    assertEquals(listOf("routeSetAside" to mapOf<String, Any?>("routeId" to a)), emitted)
  }

  @Test
  fun theLedgerAndThePinSurviveANewInstance() {
    val first = link()
    first.routes.queue(a, routeJson())
    repeat(3) { first.events.closedWith(CloseInfo(CloseReason.TIMEOUT, null, ItemRef(ItemKind.ROUTE, a))) }
    FilePinStore(File(tmp.root, "link"), {}).put(ByteArray(32) { 1 })
    val second = link()
    assertTrue(second.state.status().paired)
    val b = "0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0002"
    second.routes.queue(b, routeJson().decodeToString().replace(a, b).toByteArray())
    File(tmp.root, "outbox/$a.bin").setLastModified(1_000_000)
    File(tmp.root, "outbox/$b.bin").setLastModified(2_000_000)
    // the restart remembered a's demotion, so b is offered first although a is older
    assertEquals(b, second.routes.nextQueued()!!.routeId)
  }

  @Test
  fun unpairingIsAnnouncedAsALinkStatus() {
    val l = link()
    FilePinStore(File(tmp.root, "link"), {}).put(ByteArray(32) { 1 })
    l.state.unpair()
    assertEquals(listOf("linkStatus" to mapOf<String, Any?>("paired" to false, "reachable" to false)), emitted)
  }

  @Test
  fun aFreshLinkIsNotPairedAndNothingIsReachable() {
    val status = link().state.status()
    assertFalse(status.paired)
    assertFalse(status.reachable)
  }
}
