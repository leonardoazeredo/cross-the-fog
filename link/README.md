# link/

The local link between the phone app and the watch app (ADR 0002 and 0009): written once here, built into both apps, tested on the JVM with no hardware. Nothing in this module touches Android classes, a radio, storage or permissions; those sit behind interfaces implemented by each app.

## Two builds, one source

- The phone app's Expo build includes it through `mobile/plugins/withLinkProject.cjs` (Gradle 9.4.1, Kotlin 2.2.10) and `mobile/modules/platform` depends on it.
- `watch/` includes it in `watch/settings.gradle.kts` (Gradle 9.8.2, Kotlin 2.4.21) and `:app` depends on it.

The Kotlin plugin version comes from whichever build includes the project, so `build.gradle.kts` applies it without one. **Nothing newer than Kotlin 2.2 may be used here**: the phone build is the older of the two, and `build.gradle.kts` sets `languageVersion` and `apiVersion` to 2.2 so a newer feature fails to compile in both builds instead of only in the phone's. Raise them when the phone build's Kotlin reaches the next version. The JVM target is 17, as in `watch/`.

## Protocol and framing

Version 1, in `codes.madera.crossfog.link`:

- `Framing`: a frame is a 4-byte big-endian length then the body; at most 16 MiB (`MAX_FRAME_BYTES`), no empty frame; the length is checked before a body byte is read.
- `Messages`: the six messages as `{"v":1,"type":...}` JSON objects. Every field is checked for type, presence and bounds before a value exists; a refusal is a `ProtocolException` whose `error` is a `ProtocolError` and whose message never holds input.
- `StrictJson`: a strict RFC 8259 check of the one object, run before org.json builds anything. Android's org.json skips comments, reads `0x1` and `01`, and keeps the last of two equal keys; the JVM artifact the tests run on does none of that, so the rule is decided here and is the same on both.
- `Revision`: SHA-256 of a route's GPX text as UTF-8, 64 lowercase hex digits.
- `Protocol`: the versions spoken and how two ends agree on one. A `hello` is always `v` 1 and lists every version its sender speaks; a v1 endpoint that gets no common version answers with its own `hello` and closes.
- `Items`: the same offers as a staged or queued file holds them, with no envelope (the phone module reads those).
- `src/test/resources/vectors/messages.json`: frames in and what each must give, run by `:link:test` and by the phone module's tests (made-up data only).

## JSON

`org.json`, `compileOnly` plus the real artifact in `testImplementation`. Android provides `org.json` at runtime in both apps, so no library ships, no compiler plugin is tied to a Kotlin version and no licence notice is needed; the stub in the Android SDK does not run on the JVM, hence the artifact for tests.

## Run the tests

- Phone build: `pnpm test:android` in `mobile/` (also part of `pnpm verify`).
- Watch build: `./gradlew :link:test` in `watch/` (JDK 21, `ANDROID_HOME` set). Not part of `pnpm verify`.
