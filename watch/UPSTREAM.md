# Upstream

`watch/` is a one-time import of GlanceMap (ADR 0009), a single commit with no history.

- Upstream: https://github.com/GlanceMap/GlanceMap
- Commit: `47a04a97bed9874ab1d427d864f92b0754fa608c` (2026-11-15, "Merge pull request #121 from GlanceMap/codex/live-distance-follows-saved-track")
- Licence: MIT, `LICENSE` (GlanceMap's text, unchanged), notices in `licenses/` and in `third_party/brouter/LICENSE`.

## What was copied

Byte-identical to the pinned commit: `app/`, `third_party/brouter/`, `transfercontract/`, `licenses/`, `LICENSE`, `gradle/`, `gradle.properties`, `detekt.yml`, `build.gradle.kts`, `gradlew`, `gradlew.bat`. `third_party/brouter/` and `transfercontract/` are here only because `:app` depends on them (`:brouter-core`, `:transfercontract`).

## Left out

- `app/src/main/assets/adi-registration.properties`: a Google Play developer-identity registration for GlanceMap's own application id; it names someone else's identity and means nothing for another id.
- The phone companion (`glancemapcompanionapp/`), `macrobenchmark/`, `companionmacrobenchmark/`, `docs/`, `scripts/`, `.github/` and the top-level notes (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `TRANSLATING.md`, `TRANSFER_IMPROVEMENTS.md`): not part of the watch app.
- Upstream commits no secrets: no keystore, `google-services.json` or API key is in the tree. Release signing and the SMS API key are read from Gradle properties or the environment at build time.

## Not byte-identical

- `settings.gradle.kts`: upstream's, with the three `include(...)` lines of the modules above that were not copied removed.
- `.gitignore` and this file are new.
