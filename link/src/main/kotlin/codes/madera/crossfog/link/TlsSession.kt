package codes.madera.crossfog.link

import java.io.IOException
import java.nio.ByteBuffer
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLEngineResult

/** How a TLS session ended, for the layer above. Never carries exception text. */
enum class TlsEnd(val reason: CloseReason) {
  /** The peer sent close_notify. */
  CLEAN(CloseReason.PEER_CLOSED),

  /** The stream ended after the handshake with no close_notify. */
  TRUNCATED(CloseReason.TLS_TRUNCATED),

  /** A client that had finished its handshake got an alert or an end before the peer said anything: the server does not trust it. */
  REFUSED(CloseReason.TLS_REFUSED),

  /** The handshake or a record failed. */
  FAILED(CloseReason.TLS_FAILED),

  /** The handshake did not finish in time. */
  TIMEOUT(CloseReason.TIMEOUT),
}

/** What a [TlsSession] tells the endpoint above it. Called from the thread that calls the session, one at a time. */
interface TlsListener {
  /** The handshake finished and the protocol is TLS 1.3. Nothing above this layer has seen a byte before. */
  fun onSecure()

  /** Decrypted bytes, in pieces of any size. */
  fun onPlain(bytes: ByteArray, offset: Int, length: Int)

  /** Called once; no byte follows it. */
  fun onEnd(end: TlsEnd)
}

/**
 * TLS between a transport and an [Endpoint], on an [SSLEngine] and no threads. The caller feeds
 * transport bytes to [onBytes] and an end of the transport to [onTransportClosed], and calls
 * [tick] when [nextDeadline] has passed, like an endpoint. The endpoint writes through this object
 * as its [ByteStream]: each TLS record goes to [raw] as soon as it is made, so the write waits only
 * as long as [raw] does, and [raw] must not wait for the peer to read (see [ByteStream]).
 *
 * The engine's delegated tasks run inline. The caller opens its [Endpoint] in [TlsListener.onSecure]
 * and not before: a plaintext write earlier throws.
 */
class TlsSession(
  private val raw: ByteStream,
  private val engine: SSLEngine,
  private val trust: PinningTrustManager,
  private val clock: Clock,
  private val config: LinkConfig,
  private val listener: TlsListener,
) : ByteStream {
  private var deadline = 0L
  private var started = false
  private var secured = false
  private var ended = false
  private var sawPlain = false
  private var closeSent = false
  private var netIn = ByteArray(0)
  private var netOut = ByteBuffer.allocate(engine.session.packetBufferSize)
  private var appIn = ByteBuffer.allocate(engine.session.applicationBufferSize)

  /** Why the session was refused, when this end knows (a certificate or the protocol check); null otherwise. */
  var failure: TlsFailure? = null
    private set

  fun open() {
    check(!started) { "already opened" }
    started = true
    deadline = clock.nowMillis() + config.handshakeTimeoutMs
    engine.beginHandshake()
    advance()
  }

  fun onBytes(bytes: ByteArray, offset: Int, length: Int) {
    if (ended) return
    check(started) { "open() first" }
    netIn += bytes.copyOfRange(offset, offset + length)
    advance()
  }

  /** The transport ended. */
  fun onTransportClosed() {
    if (ended) return
    end(
      when {
        !secured -> TlsEnd.FAILED
        engine.useClientMode && !sawPlain -> TlsEnd.REFUSED
        else -> TlsEnd.TRUNCATED
      },
    )
  }

  fun tick() {
    if (!ended && !secured && started && clock.nowMillis() >= deadline) end(TlsEnd.TIMEOUT)
  }

  /** When [tick] next has something to do, or null once the handshake is done or the session over. */
  fun nextDeadline(): Long? = if (started && !secured && !ended) deadline else null

  /** Encrypts [bytes] and hands each record to the transport at once; throws if the session is not secure or is over. */
  override fun write(bytes: ByteArray) {
    check(secured) { "write before the handshake finished" }
    if (ended || closeSent) throw IOException("session closed")
    val src = ByteBuffer.wrap(bytes)
    while (src.hasRemaining()) {
      val r = wrap(src)
      if (r.status == SSLEngineResult.Status.CLOSED) throw IOException("session closed")
      check(r.bytesConsumed() > 0 || r.bytesProduced() > 0) { "TLS made no progress" }
    }
  }

  /** Sends close_notify, then closes the transport. */
  override fun close() {
    if (!ended && !closeSent) {
      closeSent = true
      try {
        engine.closeOutbound()
        wrap(ByteBuffer.allocate(0))
      } catch (e: Exception) {
        // the transport may already be gone; the close below is what matters
      }
    }
    ended = true
    raw.close()
  }

  private fun wrap(src: ByteBuffer): SSLEngineResult {
    while (true) {
      netOut.clear()
      val r = engine.wrap(src, netOut)
      if (r.status == SSLEngineResult.Status.BUFFER_OVERFLOW) {
        netOut = ByteBuffer.allocate(maxOf(netOut.capacity() * 2, engine.session.packetBufferSize))
        continue
      }
      netOut.flip()
      if (netOut.hasRemaining()) {
        val out = ByteArray(netOut.remaining())
        netOut.get(out)
        raw.write(out)
      }
      noteHandshake(r)
      return r
    }
  }

  /** Runs the handshake and unwraps what has arrived, until the engine needs more bytes. */
  private fun advance() {
    try {
      while (!ended) {
        when (engine.handshakeStatus) {
          SSLEngineResult.HandshakeStatus.NEED_TASK -> runTasks()
          SSLEngineResult.HandshakeStatus.NEED_WRAP -> wrap(ByteBuffer.allocate(0))
          else -> if (!unwrap()) return
        }
      }
    } catch (e: Exception) {
      sendAlert()
      if (!ended) end(if (secured && engine.useClientMode && !sawPlain) TlsEnd.REFUSED else TlsEnd.FAILED)
    }
  }

  /** After a failure the engine holds an alert for the peer; the peer learns why only if it is written before the transport closes. */
  private fun sendAlert() {
    try {
      if (!ended && engine.handshakeStatus == SSLEngineResult.HandshakeStatus.NEED_WRAP) wrap(ByteBuffer.allocate(0))
    } catch (e: Exception) {
      // the transport may be gone; the end below is what is reported
    }
  }

  /** One unwrap of the buffered bytes; false when the engine needs more of them. */
  private fun unwrap(): Boolean {
    if (netIn.isEmpty()) return false
    val src = ByteBuffer.wrap(netIn)
    appIn.clear()
    val r = engine.unwrap(src, appIn)
    netIn = netIn.copyOfRange(src.position(), netIn.size)
    when (r.status) {
      SSLEngineResult.Status.BUFFER_UNDERFLOW -> return false
      SSLEngineResult.Status.BUFFER_OVERFLOW -> {
        appIn = ByteBuffer.allocate(maxOf(appIn.capacity() * 2, engine.session.applicationBufferSize))
        return true
      }
      SSLEngineResult.Status.CLOSED -> {
        noteHandshake(r)
        if (!ended) {
          end(TlsEnd.CLEAN)
        }
        return false
      }
      else -> Unit
    }
    noteHandshake(r)
    if (r.bytesProduced() > 0 && !ended) {
      sawPlain = true
      val plain = ByteArray(r.bytesProduced())
      appIn.flip()
      appIn.get(plain)
      listener.onPlain(plain, 0, plain.size)
    }
    return true
  }

  private fun runTasks() {
    while (true) (engine.delegatedTask ?: break).run()
  }

  private fun noteHandshake(r: SSLEngineResult) {
    if (secured || ended) return
    if (r.handshakeStatus != SSLEngineResult.HandshakeStatus.FINISHED) return
    if (engine.session.protocol != Tls.PROTOCOL) {
      failure = TlsFailure.PROTOCOL
      end(TlsEnd.FAILED)
      return
    }
    secured = true
    listener.onSecure()
  }

  private fun end(how: TlsEnd) {
    if (ended) return
    ended = true
    if (failure == null) failure = trust.failure
    try {
      raw.close()
    } catch (e: Exception) {
      // best effort: the end is what is reported
    }
    listener.onEnd(how)
  }
}
