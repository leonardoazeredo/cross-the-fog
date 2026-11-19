# Compliance Status

Last reviewed: 2026-05-07

Status legend:
- `DONE`: implemented and verified.
- `PENDING`: needs follow-up before/after release.
- `BLOCKER`: do not ship a bundled asset without resolution.

## Current checklist

1. User-facing legal entry reachable from watch settings
   - Status: `DONE`
   - Evidence: `Settings -> Licenses` screen available in app.

2. User-friendly credits page
   - Status: `DONE`
   - Evidence: `licenses/CREDITS_AND_THANKS.md`.

3. Open-source notices for core libraries
   - Status: `DONE`
   - Evidence: `licenses/THIRD_PARTY_NOTICES.md`.

4. Data and asset attribution
   - Status: `DONE`
   - Evidence: `licenses/DATA_AND_ASSET_ATTRIBUTION.md`.

5. Service/API terms page
   - Status: `DONE`
   - Evidence: `licenses/SERVICE_TERMS_AND_API_USAGE.md`.

6. Companion external source transparency
   - Status: `DONE`
   - Evidence: `licenses/COMPANION_EXTERNAL_SOURCES.md`.

7. Overpass public instance usage limits
   - Status: `PENDING`
   - Notes:
     - Main public policy indicates conservative limits (10,000 queries/day, <1 GB/day).
     - Monitor/import throttling should remain conservative.

8. OpenHiking bundled theme redistribution/license verification
   - Status: `DONE`
   - Evidence:
     - Project owner confirmed on 2026-04-26 that approval was received from OpenHiking.
     - Project owner confirmed the OpenHiking theme license is `CC BY-SA`.
   - Notes:
     - OpenHiking snapshot is now embedded in `app/src/main/assets/theme/openhiking`.
     - OpenHiking theme ZIP integration remains available as an optional refresh path in the build pipeline.
     - The observed ZIP did not include an obvious standalone license/readme file.
     - Keep attribution and share-alike obligations with the project docs.
     - Archive the exact upstream page/version and approval details privately when available.

## Public repository and release gate

For a public repository or public app release, resolve all `BLOCKER` items.
Treat unresolved bundled asset redistribution/license `PENDING` items as
blocking unless the affected assets are removed from the public branch or the
residual risk is explicitly accepted. Publishing this repository publicly also
publishes the bundled third-party assets.

Current gate result:
- `READY FROM A BUNDLED-ASSET LICENSING STANDPOINT`, with no remaining recorded redistribution blocker for the current theme set.
- OpenHiking is no longer a blocker based on recorded confirmations where applicable and the current noncommercial distribution model where relevant.
- Remaining pre-public tasks are operational items in `docs/PUBLIC_REPO_CHECKLIST.md` such as GitHub metadata, Pages enablement, and security reporting.
