# Daten- und Quellenangaben

Zuletzt geprüft: 2026-05-07

Diese Datei dokumentiert Quellen- und Lizenzangaben für von GlanceMap genutzte Kartenressourcen ohne Programmcode, Datensätze und importierte POI-Quellen.

## 1) OpenStreetMap-Daten

- Empfohlener Quellenhinweis:
  - `Map data (c) OpenStreetMap contributors`
- Quellen:
  - https://www.openstreetmap.org/copyright
  - https://opendatacommons.org/licenses/odbl/1-0/

## 2) OpenHiking-Mapsforge-Thema

- Lokale enthaltene Themendateien:
  - `app/src/main/assets/theme/openhiking/OpenHiking.xml`
  - Ressourcenbaum `app/src/main/assets/theme/openhiking/`
- In der Konfiguration festgelegte Ursprungsversion:
  - `2026-02-10`
- Optionales Aktualisierungsarchiv zur Build-Zeit:
  - `https://openhiking.eu/en/component/phocadownload/category/1-terkepek/6-mapsforge-stilus?Itemid=102&download=14:openhiking-terkep-stilus`
- Am 2026-03-14 festgestellter extrahierter Themeninhalt:
  - `OpenHiking/OpenHiking.xml`
  - Im ZIP enthaltene SVG-/Muster-/Symbol-Unterordner.
- Ursprüngliche Verweise:
  - https://openhiking.eu/en/downloads/mapsforge-maps
  - https://openhiking.eu/locus/Hungary.xml

Wichtig:
- Das heruntergeladene ZIP enthielt keine erkennbare separate Lizenz-/Readme-Datei.
- Der Projektverantwortliche bestätigte am 2026-04-26 die Genehmigung von OpenHiking.
- Der Projektverantwortliche bestätigte `CC BY-SA` als Lizenz des OpenHiking-Themas.
- Quellenangaben und Weitergabe-unter-gleichen-Bedingungen-Pflichten in der Projektdokumentation beibehalten.
- Genaue ursprüngliche Seite/Version und Genehmigungsdetails privat archivieren, sobald verfügbar.
- Nutzerhinweis in `licenses/OPENHIKING_THEME.md` verfügbar.

## 3) Refuges.info-Datenimporte

- Die Begleit-App importiert POI-Daten von:
  - `https://www.refuges.info/api/bbox`
  - `https://www.refuges.info/api/polygones`
- Lizenzverweis:
  - https://www.refuges.info/wiki/licence

Hinweise:
- Laut Refuges.info stehen Inhalte der Punktseiten unter CC BY-SA.
- Refuges.info verweist gegebenenfalls auch auf OpenStreetMap-Daten und ODbL-Vorgaben.

## 4) Ergänzung von OSM-POI über Overpass API

- Von der Begleit-App genutzter Endpunkt:
  - `https://overpass-api.de/api/interpreter`
- Dokumentation:
  - https://wiki.openstreetmap.org/wiki/Overpass_API

Nutzungshinweis:
- Die Hinweise zur öffentlichen Instanz nennen vorsichtige Grenzen für Abfragen und Bandbreite pro Tag.

## 5) DEM-Höhendaten (Neigungs-/Geländedarstellung)

- Build und Laufzeit nutzen DEM3-artige `.hgt.zip`-Kacheln und optional `.hgt.gz`-Kacheln mit 1 Bogensekunde.
- Standardquelle in App/Build:
  - `https://download.mapsforge.org/maps/dem/dem3`
- Optionale Quelle mit 1 Bogensekunde:
  - Mapzen Terrain Tiles / AWS `skadi`
  - `https://s3.amazonaws.com/elevation-tiles-prod/skadi`
- Verweise:
  - https://download.mapsforge.org/maps/dem/
  - https://download.mapsforge.org/maps/dem/ReadMe.md
  - https://www.mapzen.com/blog/terrain-tile-service/
  - https://www.mapzen.com/rights/

## 6) POI-Symbolressourcen

- Lokale POI-Symbole stammen aus den SVG-Symbolsätzen Maki und Temaki:
  - https://github.com/mapbox/maki
  - https://github.com/rapideditor/temaki
- Der Build kann außerdem Maki-SVG-Ersatzsymbole herunterladen von:
  - https://github.com/mapbox/maki
- Lizenz:
  - CC0 1.0 Universal
  - https://creativecommons.org/publicdomain/zero/1.0/

## 7) BRouter-Routenressourcen und -segmente

- Enthaltene Routenprofilressourcen:
  - `app/src/main/assets/brouter/profiles2/lookups.dat`
  - `app/src/main/assets/brouter/profiles2/hiking-mountain.brf`
- Downloadquelle der Routensegmente in der Begleit-App:
  - `https://brouter.de/brouter/segments4`
- Ursprüngliche Verweise:
  - https://github.com/abrensch/brouter
  - https://brouter.de/brouter/

Hinweise:
- Laut BRouter werden `.rd5`-Routensegmente aus OpenStreetMap-Daten erzeugt und wöchentlich aktualisiert.
- Die OpenStreetMap-Quellenangabe bleibt für Routensegmentdaten relevant.
- Die Uhr-App bindet BRouter-Code separat unter der MIT-Lizenz ein; Lizenzhinweis zum Code in `THIRD_PARTY_NOTICES.md`.

## 8) Vom Nutzer importierte Dateien

- Die App unterstützt vom Nutzer importierte Karten-, POI- und GPX-Dateien.
- Lizenzen und Weiterverteilungsrechte bereitgestellter Dateien bleiben in der Verantwortung des Nutzers.

## 9) Praktische Konformitätsprüfliste

- Rechtliche Hinweise aus den Uhreinstellungen erreichbar halten.
- `CREDITS_AND_THANKS.md` verständlich und kurz halten.
- Ausführliche rechtliche Dokumentation mit externen Links und APIs der Begleit-App abstimmen.
- Bedingungen bei Änderungen an Anbieter-URLs oder Importquellen erneut prüfen.
