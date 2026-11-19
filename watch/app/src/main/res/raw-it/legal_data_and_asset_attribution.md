# Attribuzione dati e risorse

Ultima revisione: 2026-05-07

Questo file documenta attribuzione e licenze di risorse cartografiche non software, insiemi di dati e fonti POI importate usati da GlanceMap.

## 1) Dati OpenStreetMap

- Testo di attribuzione consigliato:
  - `Map data (c) OpenStreetMap contributors`
- Fonti:
  - https://www.openstreetmap.org/copyright
  - https://opendatacommons.org/licenses/odbl/1-0/

## 2) Tema Mapsforge OpenHiking

- File locali del tema incluso:
  - `app/src/main/assets/theme/openhiking/OpenHiking.xml`
  - Albero risorse `app/src/main/assets/theme/openhiking/`
- Versione originale fissata nella configurazione:
  - `2026-02-10`
- Archivio opzionale di aggiornamento in compilazione:
  - `https://openhiking.eu/en/component/phocadownload/category/1-terkepek/6-mapsforge-stilus?Itemid=102&download=14:openhiking-terkep-stilus`
- Contenuto estratto del tema osservato il 2026-03-14:
  - `OpenHiking/OpenHiking.xml`
  - Sottocartelle SVG/motivi/simboli incluse nello ZIP.
- Riferimenti originali:
  - https://openhiking.eu/en/downloads/mapsforge-maps
  - https://openhiking.eu/locus/Hungary.xml

Importante:
- Lo ZIP scaricato non includeva un evidente file licenza/readme separato.
- Il responsabile del progetto ha confermato il 2026-04-26 l'approvazione di OpenHiking.
- Il responsabile del progetto ha confermato che la licenza del tema OpenHiking è `CC BY-SA`.
- Conservare attribuzione e obblighi di condivisione allo stesso modo nella documentazione del progetto.
- Archiviare privatamente pagina/versione originale esatta e dettagli dell'approvazione, quando disponibili.
- Nota per gli utenti disponibile in `licenses/OPENHIKING_THEME.md`.

## 3) Importazioni dati Refuges.info

- L'app companion importa dati POI da:
  - `https://www.refuges.info/api/bbox`
  - `https://www.refuges.info/api/polygones`
- Riferimento licenza:
  - https://www.refuges.info/wiki/licence

Note:
- Refuges.info indica che i contenuti delle pagine dei punti sono sotto CC BY-SA.
- Refuges.info rimanda anche ai dati OpenStreetMap e ai vincoli ODbL ove applicabili.

## 4) Arricchimento POI OSM tramite Overpass API

- Endpoint usato dall'app companion:
  - `https://overpass-api.de/api/interpreter`
- Documentazione:
  - https://wiki.openstreetmap.org/wiki/Overpass_API

Nota d'uso:
- Le indicazioni dell'istanza pubblica prevedono limiti prudenti di richieste e banda giornaliere.

## 5) Dati altimetrici DEM (visualizzazione pendenze/rilievi)

- Compilazione ed esecuzione usano tessere `.hgt.zip` di tipo DEM3 e tessere opzionali `.hgt.gz` da 1 secondo d'arco.
- Fonte predefinita nell'app/compilazione:
  - `https://download.mapsforge.org/maps/dem/dem3`
- Fonte opzionale da 1 secondo d'arco:
  - Mapzen Terrain Tiles / AWS `skadi`
  - `https://s3.amazonaws.com/elevation-tiles-prod/skadi`
- Riferimenti:
  - https://download.mapsforge.org/maps/dem/
  - https://download.mapsforge.org/maps/dem/ReadMe.md
  - https://www.mapzen.com/blog/terrain-tile-service/
  - https://www.mapzen.com/rights/

## 6) Risorse icone POI

- Le icone POI locali derivano dalle raccolte SVG Maki e Temaki:
  - https://github.com/mapbox/maki
  - https://github.com/rapideditor/temaki
- La compilazione può anche scaricare icone SVG Maki di riserva da:
  - https://github.com/mapbox/maki
- Licenza:
  - CC0 1.0 Universal
  - https://creativecommons.org/publicdomain/zero/1.0/

## 7) Risorse e segmenti percorsi BRouter

- Risorse profili percorsi incluse:
  - `app/src/main/assets/brouter/profiles2/lookups.dat`
  - `app/src/main/assets/brouter/profiles2/hiking-mountain.brf`
- Fonte download segmenti percorsi nell'app companion:
  - `https://brouter.de/brouter/segments4`
- Riferimenti originali:
  - https://github.com/abrensch/brouter
  - https://brouter.de/brouter/

Note:
- BRouter dichiara che i segmenti percorsi `.rd5` sono generati da dati OpenStreetMap e aggiornati ogni settimana.
- L'attribuzione OpenStreetMap resta pertinente per i dati dei segmenti percorsi.
- L'app orologio include separatamente il codice BRouter sotto licenza MIT; vedi `THIRD_PARTY_NOTICES.md` per l'avviso sulla licenza del codice.

## 8) File importati dall'utente

- L'app supporta file mappa/POI/GPX importati dall'utente.
- Licenze e diritti di ridistribuzione dei file forniti restano responsabilità dell'utente.

## 9) Lista pratica di conformità

- Mantenere una schermata legale accessibile dalle impostazioni dell'orologio.
- Mantenere `CREDITS_AND_THANKS.md` breve e comprensibile.
- Mantenere la documentazione legale dettagliata allineata ai collegamenti e alle API esterne dell'app companion.
- Ricontrollare le condizioni quando cambiano URL dei fornitori o fonti d'importazione.
