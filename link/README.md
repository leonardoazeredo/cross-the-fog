# link/

The local link between the phone app and the watch app (ADR 0002 and 0009): written once here, built into both apps, tested on the JVM with no hardware. Nothing in this module touches Android classes, a radio, storage or permissions; those sit behind interfaces implemented by each app.

## Two builds, one source

- The phone app's Expo build includes it through `mobile/plugins/withLinkProject.cjs` (Gradle 9.4.1, Kotlin 2.2.10) and `mobile/modules/platform` depends on it.
- `watch/` includes it in `watch/settings.gradle.kts` (Gradle 9.8.2, Kotlin 2.4.21) and `:app` depends on it.

The Kotlin plugin version comes from whichever build includes the project, so `build.gradle.kts` applies it without one. **Nothing newer than Kotlin 2.2 may be used here**: the phone build is the older of the two, and `build.gradle.kts` sets `languageVersion` and `apiVersion` to 2.2 so a newer feature fails to compile in both builds instead of only in the phone's. Raise them when the phone build's Kotlin reaches the next version. The JVM target is 17, as in `watch/`.

## Protocol and framing

Version 1, in `codes.madera.crossfog.link`:

- `Framing`: a frame is a 4-byte big-endian length then the body; at most 16 MiB (`MAX_FRAME_BYTES`), no empty frame; the length is checked before a body byte is read.
- `Messages`: the eleven messages (six for a normal session, five for pairing) as `{"v":1,"type":...}` JSON objects. Every field is checked for type, presence and bounds before a value exists; a refusal is a `ProtocolException` whose `error` is a `ProtocolError` and whose message never holds input.
- `StrictJson`: a strict RFC 8259 check of the one object, run before org.json builds anything. Android's org.json skips comments, reads `0x1` and `01`, and keeps the last of two equal keys; the JVM artifact the tests run on does none of that, so the rule is decided here and is the same on both.
- `Revision`: SHA-256 of a route's GPX text as UTF-8, 64 lowercase hex digits.
- `Protocol`: the versions spoken and how two ends agree on one. A `hello` is always `v` 1 and lists every version its sender speaks; a v1 endpoint that gets no common version answers with its own `hello` and closes.
- `Items`: the same offers as a staged or queued file holds them, with no envelope (the phone module reads those).
- `src/test/resources/vectors/messages.json`: frames in and what each must give, run by `:link:test` and by the phone module's tests (made-up data only).

## Endpoints

`PhoneEndpoint` and `WatchEndpoint` (over the shared `Endpoint`) are the two ends of one session on one stream. They are state machines the caller drives, with no thread, no sleep and no clock of their own:

- The caller owns the stream and the threads, and calls `open()`, `onBytes(bytes, offset, length)`, `onClosed()`, `tick()` (when `nextDeadline()` has passed on the injected `Clock`) and `wake()` (an item was queued) one at a time, from one thread or under one lock. Nothing in `link/` blocks, so the phone can run it on a socket's executor, the watch from its own loop, and a TLS engine (which wraps and unwraps without threads) can feed it the same way.
- Outside `link/` are only the interfaces in `Ports.kt`: `ByteStream`, `Clock`, `PhoneRouteStore`, `ActivitySink`, `WatchRouteStore`, `ActivityOutbox`, `LinkEvents`. The stores hold only what is queued and what is delivered; what is in flight lives in the endpoint, so a lost session needs no recovery. The caller makes a new stream and endpoint, the stores still say what is queued, and a resend is answered by the peer with the confirmation and no second write (the stores say `ALREADY_HELD` for the same activity id, or the same route id and revision).
- One item per direction is outstanding at a time (stop and wait). `Framing.Decoder` cuts frames from bytes of any chunking.
- Nothing is sent before the peer's hello has agreed a version. Both ends send their hello when the link opens, so a peer with no common version has already been answered with ours when the endpoint closes.
- `ByteStream.write` must not wait for the peer to read (queue the bytes for a writer the caller drains beside its reads), or two ends writing a large item at once could both block with no way to read or tick; the confirmation wait then includes the transfer, so size `LinkConfig.confirmTimeoutMs` for the slowest link.
- `LinkEvents.closed(reason, itemId)` names the item a failing store or an unframeable item was about when it closed the session. That item is first in the queue next session, so a caller that sees the same id fail every time sets it aside (stores queue through `Items`, which already refuses an item whose wire form is over the cap).
- Anything unexpected ends the session with one `CloseReason` and leaves the stores as they were: nothing is confirmed that was not stored, and a confirmation is never acted on that does not match what is outstanding. On a timeout the endpoint closes rather than resends on the same stream, because its own resend would earn a second, legitimate confirmation. The confirmation wait starts when the write returns, and a `ping` does not extend it.

### Both ends

| State | Event | Next | Action |
|---|---|---|---|
| New | `open()` | AwaitingHello | write our hello; the hello wait starts |
| AwaitingHello | hello with a common version | Ready | `ready()`; send the next queued item |
| AwaitingHello | hello with none | Closed `NO_COMMON_VERSION` | none: our hello already went out |
| AwaitingHello | any other message | Closed `UNEXPECTED_MESSAGE` | none |
| AwaitingHello | `tick()` past the hello wait | Closed `TIMEOUT` | none |
| Ready | hello again | Closed `UNEXPECTED_MESSAGE` | none |
| Ready | ping | Ready | none |
| Ready | `tick()` past the wait for a confirmation | Closed `TIMEOUT` | the item stays queued |
| AwaitingHello, Ready | bytes that are not a frame or message | Closed `BAD_FRAME` | none |
| AwaitingHello, Ready | `onClosed()` | Closed `PEER_CLOSED`, or `CUT_MID_FRAME` inside a frame | the partial frame is dropped unread |
| AwaitingHello, Ready | a write fails | Closed `WRITE_FAILED` | the item stays queued |
| AwaitingHello, Ready | an item cannot be framed | Closed `UNSENDABLE_ITEM` | the item stays queued |
| any | `close()` | Closed `LOCAL` | none |

### Phone, in Ready (Idle: no route offered; Offered: one route's id and revision outstanding)

| State | Event | Next | Action |
|---|---|---|---|
| Idle | ready, `wake()`, or a route delivered; queue empty | Idle | none |
| Idle | the same, a route queued | Offered | read it from the store, write `routeOffer`, start the wait |
| Offered | `routeSaved` with the offered id and revision | Idle | `markDelivered(id, revision)` (compare and mark in the store); send the next route |
| Offered | the same, and `markDelivered` throws | Closed `STORE_FAILED` | the route stays queued |
| Idle, Offered | `routeSaved` for another id or revision, a second one, or one with nothing offered | Closed `UNEXPECTED_MESSAGE` | the store is not touched |
| Idle, Offered | `activityOffer` | same | `ActivitySink.store`; on `SAVED` or `ALREADY_HELD` write `activityStored` |
| Idle, Offered | `activityOffer`, and the sink throws | Closed `STORE_FAILED` | no confirmation; the watch keeps it |
| Idle, Offered | `routeOffer` or `activityStored` | Closed `UNEXPECTED_MESSAGE` | none |

### Watch, in Ready (Idle: no activity offered; Offered: one activity's id outstanding)

| State | Event | Next | Action |
|---|---|---|---|
| Idle | ready, `wake()`, or an activity deleted; outbox empty | Idle | none |
| Idle | the same, an activity queued | Offered | read it from the outbox, write `activityOffer`, start the wait |
| Offered | `activityStored` for the offered id | Idle | `delete(id)`; send the next activity |
| Offered | the same, and `delete` throws | Closed `STORE_FAILED` | the activity stays queued |
| Idle, Offered | `activityStored` for another id, a second one, or one with nothing offered | Closed `UNEXPECTED_MESSAGE` | the outbox is not touched |
| Idle, Offered | `routeOffer` | same | `WatchRouteStore.save`; on `SAVED` or `ALREADY_HELD` write `routeSaved` with the revision received |
| Idle, Offered | `routeOffer`, and the store throws | Closed `STORE_FAILED` | no confirmation; the phone keeps it |
| Idle, Offered | `routeSaved` or `activityOffer` | Closed `UNEXPECTED_MESSAGE` | none |

### Memory

An endpoint keeps one id (and for a route a revision) of what it has offered, never the item. A send reads the item from the store, and `Messages.encode` builds the JSON text and its UTF-8 bytes from it; the length goes out as its own 4-byte write rather than joined to the body (`Framing.prefix`), so there is no third copy of the body. A receive holds one array of the frame's size while it arrives (`Framing.Decoder` allocates as bytes come, doubling, so while it grows it also holds the array it replaces) and then `Messages.parse` makes what it makes (the decoded text, the parsed fields). An item of 16 MiB is therefore held in several copies at the peak, as before; nothing in the endpoints adds one, and shrinking them is #478.

## TLS and pairing

Every byte of a session is inside mutually authenticated TLS 1.3, on the platform's TLS (`SSLEngine`); `link/` writes no cryptography, only `MessageDigest`, `Mac`, `SecureRandom` and `MessageDigest.isEqual`.

- **Roles.** The TLS server is the watch in a pairing session (it shows the QR and listens) and the phone in a normal one (the phone listens). Which end is the TLS server is separate from which `Endpoint` it runs. A server always asks for a client certificate.
- **`Tls.engine`** builds a fresh context per engine (no session cache spans sessions, so nothing is resumed and every handshake asks the trust manager), enables `TLSv1.3` only and sets no SNI or host name. `TlsSession` then refuses a session whose negotiated protocol is not `TLSv1.3`. The cipher suite list is the platform's: Conscrypt ignores a TLS 1.3 suite list ("any attempt to disable them via a call to setEnabledCipherSuites() is ignored", Conscrypt `CAPABILITIES.md`), so a list set here would only bind the JVM.
- **`PinningTrustManager`** is the only trust decision and never reads the system store, dates, names or issuers. It accepts one certificate (a chain of two is refused) holding an EC P-256 key whose SHA-256 of the SPKI (`Spki.hash`) equals the pin, compared with `MessageDigest.isEqual`. Dates are ignored on purpose: the certificate only carries the key, a watch with a wrong clock must not lose its link, and a key is retired by pairing again. `pinned(PinStore)` reads the pin at each handshake, so unpairing and pairing again apply to the next session. The one other manager, `acceptingAnyKey()`, is the watch's in a pairing session: it records the phone's key hash and trusts nothing; the key is pinned only after the code proof.
- **`Identity`** (certificate chain and a `PrivateKey` that may be non-extractable) and **`PinStore`** (`get`, `put` replacing in one step, `clear`; one peer per side) are the only things an app supplies for keys. Android Keystore keys fit without a change here.
- **`TlsSession`** sits between the transport and an `Endpoint`: the caller feeds it transport bytes and an end of transport, and opens its endpoint in `onSecure()`. Each TLS record goes to the transport as soon as it is made, so `write` waits only as long as the transport's does (see `ByteStream`). Delegated tasks run inline. A handshake that does not finish within `LinkConfig.handshakeTimeoutMs` ends with `TIMEOUT`.
- **How a session ends** (`TlsEnd`, mapped to `CloseReason`): `close_notify` is `PEER_CLOSED`; an end of stream without one after the handshake is `TLS_TRUNCATED`; a handshake or record failure is `TLS_FAILED` (the kind is on the session as `TlsFailure`, never exception text). In TLS 1.3 the client's handshake is finished before the server has checked the client certificate, so a client the server does not trust has a secure session and has written its hello before it learns it was refused. The server never reads those bytes (it fails before any application data and its endpoint never opens), and the client's alert or end of stream before any message from the server is `TLS_REFUSED`: that is how a watch learns it was unpaired.

### Pairing

The watch shows `crossfog:1:<watch key hash>:<code>:<hint>` as a QR (`QrPayload`: base64url without padding, at most 110 characters, hint `rfcomm` or `tcp:<ipv4>:<port>`), the phone scans it. `PairingOffer` holds the 16-byte code in the watch's memory for `LinkConfig.pairingWindowMs` (5 minutes) and counts tries across connections: three wrong destroy the code, a right one spends it. The phone's trust manager accepts only the key hash of the QR, so a relay with another key fails the handshake.

| Message | From | Meaning |
|---|---|---|
| `pairRequest {proof}` | phone | `proof` is HMAC-SHA256 keyed with the code over the label `crossfog-pair-1`, the watch key hash and the phone key hash (`Pairing.proof`), 64 lowercase hex |
| `pairAccepted` | watch | the proof matched and the code is spent; nothing is stored yet |
| `pairRejected {reason}` | watch | `wrong_code`, `code_used`, `expired`, `too_many_tries` |
| `pairConfirm` | phone | the phone holds the watch's key hash and will commit it when the watch is done |
| `pairDone` | watch | the watch has stored the phone's key hash |

Commit points: the **watch** replaces its pin when `pairConfirm` arrives, and the **phone** when `pairDone` arrives. Until then both pin stores are untouched, so a pairing that is refused or drops before the commit leaves a working pairing working. The one window is a drop after the watch committed and before the phone did: if the phone's key is unchanged the two pins are equal to the old ones and the old pairing still works; if the phone's key is new, the watch no longer trusts the old phone and pairing again closes it. A pairing session reads frames of at most `Pairing.MAX_FRAME_BYTES` (512) because the watch accepts any peer there. Pairing messages are v1 messages: a normal session refuses them and a pairing session refuses the others (`UNEXPECTED_MESSAGE`). There is no unpair message: each app clears its own `PinStore` (and the phone its companion association), and the other end learns from the next refused handshake.

On Android (phone emulator, API 36) `KeystoreIdentityTest` and `KeystoreSessionTest` in `mobile/modules/platform/android/src/androidTest` run the pairing session and the normal session with Keystore identities. What they pinned, all as on the JVM: Keystore keys sign for TLS 1.3 (they need the `NONE` digest), a pinned session carries a route and an activity, a client the server does not pin finishes its handshake and then learns it was refused (`TLS_REFUSED`; nothing from the phone is saved on the watch), a server that is not the pinned key is refused by the client before its endpoint opens, a TLS 1.2-only client is refused (the phone ends `TLS_FAILED` and closes its stream; the client has no failure and stays in `NEED_UNWRAP`, its protocol `NONE`), and Conscrypt negotiates `TLSv1.3` with one of `TLS_AES_128_GCM_SHA256`, `TLS_AES_256_GCM_SHA384`, `TLS_CHACHA20_POLY1305_SHA256`. The key hash each end computes for itself equals the one its peer derives from the certificate (both pins commit in the pairing test). Not run on a real device or on a watch.

## Sessions and failing items

`Sessions` builds the four sessions (`pairingWatch`, `pairingPhone`, `normalPhone`, `normalWatch`): TLS and the endpoint above it as one `SecureSession` an app drives with `onBytes`, `onTransportClosed`, `tick`, `nextDeadline` and `wake`. The endpoint is created only once the handshake is done and TLS 1.3 is confirmed; a session that ends sooner reports its TLS reason through `closedWith` and never `ready`. Each call makes a new trust manager and engine.

`LinkEvents.closedWith(CloseInfo)` is what an endpoint calls when it stops; `closed(reason, itemId)` remains and is what its default forwards to. `CloseInfo.failed` is the item a store threw on or that could not be framed (it may be the peer's); `CloseInfo.inFlight` is this end's own item that was offered and not confirmed, whatever ended the session.

`ItemLedger` keeps a queue moving past an item that fails every session, with ids and counts only (bounded, persisted through a `LedgerStore`):

- A definite local failure of an own item (`STORE_FAILED`, `UNSENDABLE_ITEM`) three times with no confirmation between gives `SetAside`: the app takes the item out of the queue without deleting it and tells the user.
- An unconfirmed end with an own item in flight (timeout, closed peer, cut frame, truncated TLS: all things a weak radio does) three times with no confirmation between gives `Demoted`: `prefer(queued)` offers every other item first. The item is still retried and nothing is parked; a confirmation (`confirmed`) resets it.

The apps' queues call `prefer` with the queued ids in order and offer the id it returns.

What this does not cover: an item the receiver can never store ends every session when it arrives (`STORE_FAILED`), and an answer behind it in the same stream is lost with the session. So with one such item in one direction and a healthy item queued the other way, the healthy item's confirmation never lands, and demotion cannot help while the bad item is the only one queued. Fixing that needs the receiver to refuse an item without ending the session, which is a protocol change.

## JSON

`org.json`, `compileOnly` plus the real artifact in `testImplementation`. Android provides `org.json` at runtime in both apps, so no library ships, no compiler plugin is tied to a Kotlin version and no licence notice is needed; the stub in the Android SDK does not run on the JVM, hence the artifact for tests.

## Run the tests

- Phone build: `pnpm test:android` in `mobile/` (also part of `pnpm verify`).
- Watch build: `./gradlew :link:test` in `watch/` (JDK 21, `ANDROID_HOME` set). Not part of `pnpm verify`.
