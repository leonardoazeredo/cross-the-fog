# Condizioni dei servizi e uso delle API

Ultima revisione: 2026-05-06

Questo documento raccoglie vincoli legali e d'uso, esclusi quelli delle librerie, per servizi e fornitori esterni referenziati dall'app e dalla compilazione.

## 1) OpenAndroMaps

Usato per:
- Consigli per scaricare mappe nell'app companion.

Riferimenti:
- https://www.openandromaps.org/en/license

Note importanti sulle condizioni (dalla pagina licenza originale):
- I collegamenti diretti alle mappe sono indicati come vietati.
- Vendere mappe o includerle in un'app richiede il permesso scritto del fornitore.
- L'integrazione dei temi "andromaps_" è generalmente consentita per servizi di aggiornamento gratuiti.

## 2) Tema Mapsforge OpenHiking

Usato per:
- Risorse locali del tema OpenHiking incluse nell'app orologio.
- Download opzionale di aggiornamento OpenHiking nella compilazione dell'orologio.
- Riferimento al sito mappe/temi OpenHiking nell'app companion.

Riferimenti:
- https://openhiking.eu/en/downloads/mapsforge-maps
- https://openhiking.eu/en/component/phocadownload/category/1-terkepek/6-mapsforge-stilus?Itemid=102&download=14:openhiking-terkep-stilus

Note sulle condizioni:
- Il sito pubblico offre collegamenti diretti per download/installazione, ma non è stata trovata un'API generale documentata.
- Lo ZIP del tema scaricato ed esaminato il 2026-03-14 non conteneva un evidente file licenza/readme separato.

Stato del progetto:
- Il responsabile del progetto ha confermato il 2026-04-26 l'approvazione di OpenHiking.
- Il responsabile del progetto ha confermato che la licenza del tema OpenHiking è `CC BY-SA`.
- Conservare attribuzione e obblighi di condivisione allo stesso modo nella documentazione del progetto.
- Documentare i dettagli della copia attuale in `licenses/OPENHIKING_THEME.md`.

## 3) API e dati Refuges.info

Usato per:
- Chiamate API dell'app companion a:
  - `https://www.refuges.info/api/bbox`
  - `https://www.refuges.info/api/polygones`

Riferimenti:
- Radice API: https://www.refuges.info/api
- Pagina licenza: https://www.refuges.info/wiki/licence

Note sulle condizioni:
- I contenuti delle pagine dei punti Refuges.info sono pubblicati sotto Creative Commons BY-SA.
- Refuges.info riusa anche dati OpenStreetMap sotto ODbL ove applicabile.

## 4) OpenStreetMap e Overpass

Usato per:
- Attribuzione OSM nell'app.
- Tessere raster di sfondo del selettore mappe nell'app companion:
  - `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- Arricchimento POI OSM tramite l'endpoint Overpass API:
  - `https://overpass-api.de/api/interpreter`

Riferimenti:
- Copyright e attribuzione OSM: https://www.openstreetmap.org/copyright
- Politica d'uso tessere OSM: https://operations.osmfoundation.org/policies/tiles/
- ODbL: https://opendatacommons.org/licenses/odbl/1-0/
- Documentazione Overpass API: https://wiki.openstreetmap.org/wiki/Overpass_API

Nota sulla politica d'uso:
- Usare le tessere OSM solo per normale visualizzazione interattiva. Non aggiungere precaricamento, download massivi o cache offline delle tessere da `tile.openstreetmap.org`.
- Le tessere OSM richiedono attribuzione visibile, URL HTTPS ufficiale, User-Agent chiaro dell'app e cache HTTP rispettosa delle intestazioni del server.
- Le indicazioni dell'istanza pubblica Overpass consigliano un uso prudente intorno a:
  - meno di 10000 richieste/giorno
  - meno di 1 GB scaricato/giorno

## 5) Motore percorsi e segmenti BRouter

Usato per:
- Calcolo percorsi offline nell'app orologio tramite moduli BRouter inclusi.
- Download di file segmenti percorsi `.rd5` dall'app companion da:
  - `https://brouter.de/brouter/segments4`

Riferimenti:
- Progetto: https://github.com/abrensch/brouter
- Sito ufficiale: https://brouter.de/brouter/
- Cartella segmenti: https://brouter.de/brouter/segments4/

Note su condizioni e attribuzione:
- Il progetto originale dichiara che BRouter è rilasciato sotto licenza MIT.
- Il progetto originale dichiara che i file segmenti `.rd5` sono generati da dati OpenStreetMap e aggiornati ogni settimana.
- Attribuzione OpenStreetMap e contesto ODbL restano quindi pertinenti per i dati percorsi BRouter.

Nota del progetto:
- Nelle pagine originali BRouter esaminate il 2026-03-20 non è stata identificata una pagina pubblica separata su condizioni del servizio o limiti di frequenza.
- Deduzione del progetto: mantenere prudenti i download dell'app companion e ricontrollare le condizioni originali prima di automazioni su larga scala.

## 6) DEM e fonti del terreno

Usato per:
- Download DEM3 da:
  - `https://download.mapsforge.org/maps/dem/dem3`
- Download DEM opzionali da 1 secondo d'arco da:
  - Mapzen Terrain Tiles / AWS `skadi`
  - `https://s3.amazonaws.com/elevation-tiles-prod/skadi`

Riferimenti:
- https://download.mapsforge.org/maps/dem/
- https://download.mapsforge.org/maps/dem/ReadMe.md
- https://www.mapzen.com/blog/terrain-tile-service/
- https://www.mapzen.com/rights/

## 7) Fonte icone POI in compilazione

Usato per:
- Download icone SVG Maki in compilazione.

Riferimenti:
- https://github.com/mapbox/maki
- Licenza: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)

## 8) Contesto condizioni Google Play services

Usato per:
- Dipendenze d'esecuzione `play-services-wearable` e `play-services-location`.

Riferimenti:
- Contratto di licenza Android SDK: https://developer.android.com/studio/terms
- Guida avvisi open source Google Play services: https://developers.google.com/android/guides/opensource

Nota:
- Si tratta di condizioni SDK/servizi Google, non licenze open source standard come Apache/LGPL.

## 9) Dichiarazione di non affiliazione

L'app rimanda a fornitori e siti esterni per comodità dell'utente. Salvo loro esplicita dichiarazione, GlanceMap non è ufficialmente affiliato né approvato da essi.
