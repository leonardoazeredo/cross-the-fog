# Upstream

`watch/` is a one-time import of GlanceMap (ADR 0009), a single commit with no history.

- Upstream: https://github.com/GlanceMap/GlanceMap
- Commit: `47a04a97bed9874ab1d427d864f92b0754fa608c` (2026-11-15, "Merge pull request #121 from GlanceMap/codex/live-distance-follows-saved-track")
- Licence: MIT, `LICENSE` (GlanceMap's text, unchanged), notices in `licenses/`.

## Themes removed for their licence (#498)

Removed from `assets/theme/`: Elevate, Elevate Winter, Elevate Winter White (CC BY-NC-SA 4.0), Hike-Ride-Sight, OS Map, Tiramisu, Voluntary (CC BY-NC-SA 3.0) and French Kiss (no licence on record), with Elevate's own `ele-res/`, root `Elevate.xml` and `read_me_elevate.txt`, their notices in `licenses/`, `assets/licenses/` and `res/raw*`, and their strings. Kept: OpenHiking (CC BY-SA, the default theme now) and `hiking-3d`. The map still has the Mapsforge library's built-in styles (Classic and the others in `MapsforgeThemeCatalog.options`). A stored choice of a removed theme falls back to the default (`MapsforgeThemeCatalog.bundledThemeOrDefault`).

## What was copied

As imported, byte-identical to the pinned commit: `app/`, `third_party/brouter/`, `transfercontract/`, `licenses/`, `LICENSE`, `gradle/`, `gradle.properties`, `detekt.yml`, `build.gradle.kts`, `gradlew`, `gradlew.bat`. The tree has since been stripped (see below), so it no longer matches the pin.

## Left out

- `app/src/main/assets/adi-registration.properties`: a Google Play developer-identity registration for GlanceMap's own application id; it names someone else's identity and means nothing for another id.
- The phone companion (`glancemapcompanionapp/`), `macrobenchmark/`, `companionmacrobenchmark/`, `docs/`, `scripts/`, `.github/` and the top-level notes (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `TRANSLATING.md`, `TRANSFER_IMPROVEMENTS.md`): not part of the watch app.
- Upstream commits no secrets: no keystore, `google-services.json` or API key is in the tree. Release signing and the SMS API key are read from Gradle properties or the environment at build time.

## Not byte-identical

- `settings.gradle.kts`: upstream's, with the three `include(...)` lines of the modules above that were not copied removed.
- `.gitignore` and this file are new.

## Stripped after the import (#406)

Removed from the imported tree: 3D terrain, POI import and lookup, on-watch route planning with the BRouter modules (`third_party/brouter/` and `assets/brouter/` are gone), the diagnostics export, the Wear Data Layer and the LAN file transfer. `transfercontract/` keeps only `MapsforgeThemePackage.kt`, which the theme store reads. Hill shading and the relief overlay were kept. The commit messages of that PR list what each removal deleted, and what was left as unused code or data.
