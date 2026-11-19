# Data and Asset Attribution

Last reviewed: 2026-05-07

This file tracks attribution and licensing notes for non-code map assets, datasets and imported POI sources used by GlanceMap.

## 1) OpenStreetMap data

- Recommended attribution text:
  - `Map data (c) OpenStreetMap contributors`
- Sources:
  - https://www.openstreetmap.org/copyright
  - https://opendatacommons.org/licenses/odbl/1-0/

## 2) OpenHiking Mapsforge theme

- Local embedded theme files:
  - `app/src/main/assets/theme/openhiking/OpenHiking.xml`
  - `app/src/main/assets/theme/openhiking/` resource tree
- Pinned upstream version in project config:
  - `2026-02-10`
- Optional build-time refresh archive:
  - `https://openhiking.eu/en/component/phocadownload/category/1-terkepek/6-mapsforge-stilus?Itemid=102&download=14:openhiking-terkep-stilus`
- Extracted theme contents observed on 2026-03-14:
  - `OpenHiking/OpenHiking.xml`
  - SVG/pattern/symbol subdirectories bundled inside the ZIP.
- Upstream references:
  - https://openhiking.eu/en/downloads/mapsforge-maps
  - https://openhiking.eu/locus/Hungary.xml

Important:
- The downloaded ZIP did not include an obvious standalone license/readme file.
- Project owner confirmed on 2026-04-26 that approval was received from OpenHiking.
- Project owner confirmed the OpenHiking theme license is `CC BY-SA`.
- Keep attribution and share-alike obligations with the project docs.
- Archive the exact upstream page/version and approval details privately when available.
- User-facing note is available in `licenses/OPENHIKING_THEME.md`.

## 3) Refuges.info data imports

- Companion imports POI data from:
  - `https://www.refuges.info/api/bbox`
  - `https://www.refuges.info/api/polygones`
- License reference:
  - https://www.refuges.info/wiki/licence

Notes:
- Refuges.info indicates point-page content under CC BY-SA.
- Refuges.info also references OpenStreetMap data and ODbL constraints where applicable.

## 4) Overpass API enrichment for OSM POIs

- Companion enrichment endpoint:
  - `https://overpass-api.de/api/interpreter`
- Documentation:
  - https://wiki.openstreetmap.org/wiki/Overpass_API

Usage note:
- Public instance guidance indicates conservative limits (query/day and bandwidth/day).

## 5) DEM elevation data (slope/hill rendering)

- Build/runtime flows use DEM3-style `.hgt.zip` tiles and optional 1 arcsecond `.hgt.gz` tiles.
- Default source in app/build pipeline:
  - `https://download.mapsforge.org/maps/dem/dem3`
- Optional 1 arcsecond source:
  - Mapzen Terrain Tiles / AWS `skadi`
  - `https://s3.amazonaws.com/elevation-tiles-prod/skadi`
- References:
  - https://download.mapsforge.org/maps/dem/
  - https://download.mapsforge.org/maps/dem/ReadMe.md
  - https://www.mapzen.com/blog/terrain-tile-service/
  - https://www.mapzen.com/rights/

## 6) POI icon assets

- Local POI source icons are derived from Maki and Temaki SVG icon sets:
  - https://github.com/mapbox/maki
  - https://github.com/rapideditor/temaki
- The build pipeline may also download Maki SVG fallbacks from:
  - https://github.com/mapbox/maki
- License:
  - CC0 1.0 Universal
  - https://creativecommons.org/publicdomain/zero/1.0/

## 7) BRouter routing assets and segments

- Bundled routing profile assets:
  - `app/src/main/assets/brouter/profiles2/lookups.dat`
  - `app/src/main/assets/brouter/profiles2/hiking-mountain.brf`
- Companion routing segment download source:
  - `https://brouter.de/brouter/segments4`
- Upstream references:
  - https://github.com/abrensch/brouter
  - https://brouter.de/brouter/

Notes:
- BRouter upstream states `.rd5` routing segments are generated from OpenStreetMap data and updated weekly.
- OpenStreetMap attribution remains relevant for the routing-segment data context.
- The watch app vendors BRouter code separately under the MIT License; see `THIRD_PARTY_NOTICES.md` for the code-license notice.

## 8) User-imported files

- The app supports user-imported map/POI/GPX files.
- Licensing and redistribution rights for user-provided files remain the user's responsibility.

## 9) Practical compliance checklist

- Keep a legal screen reachable from watch settings.
- Keep `CREDITS_AND_THANKS.md` user-friendly and short.
- Keep deeper legal docs in sync with companion external links and APIs.
- Re-check terms whenever provider URLs or import sources change.
