# Attribution des données et ressources

Dernière révision : 2026-05-07

Ce fichier consigne les attributions et licences des ressources cartographiques hors code, jeux de données et sources de POI importés utilisés par GlanceMap.

## 1) Données OpenStreetMap

- Attribution recommandée :
  - `Map data (c) OpenStreetMap contributors`
- Sources :
  - https://www.openstreetmap.org/copyright
  - https://opendatacommons.org/licenses/odbl/1-0/

## 2) Thème Mapsforge OpenHiking

- Fichiers intégrés :
  - `app/src/main/assets/theme/openhiking/OpenHiking.xml`
  - arborescence `app/src/main/assets/theme/openhiking/`
- Version d’origine figée dans la configuration :
  - `2026-02-10`
- Archive facultative d’actualisation à la compilation :
  - `https://openhiking.eu/en/component/phocadownload/category/1-terkepek/6-mapsforge-stilus?Itemid=102&download=14:openhiking-terkep-stilus`
- Contenu extrait observé le 2026-03-14 :
  - `OpenHiking/OpenHiking.xml`
  - sous-dossiers SVG/motifs/symboles inclus dans le ZIP.
- Références d’origine :
  - https://openhiking.eu/en/downloads/mapsforge-maps
  - https://openhiking.eu/locus/Hungary.xml

Important :
- Le ZIP téléchargé ne contenait pas de fichier de licence/readme distinct clairement identifiable.
- Le responsable du projet a confirmé le 2026-04-26 avoir reçu l’accord d’OpenHiking.
- Il a confirmé la licence `CC BY-SA` du thème.
- Conserver les obligations d’attribution et de partage à l’identique dans la documentation.
- Archiver en privé la page/version exacte et les détails de l’accord lorsqu’ils sont disponibles.
- Note utilisateur : `licenses/OPENHIKING_THEME.md`.

## 3) Imports Refuges.info

- Le compagnon importe les POI depuis :
  - `https://www.refuges.info/api/bbox`
  - `https://www.refuges.info/api/polygones`
- Référence de licence :
  - https://www.refuges.info/wiki/licence

Notes :
- Refuges.info indique que le contenu des pages de points est sous CC BY-SA.
- Refuges.info renvoie aussi aux données OpenStreetMap et aux obligations ODbL lorsqu’elles s’appliquent.

## 4) Enrichissement des POI OSM via Overpass API

- Point d’accès du compagnon :
  - `https://overpass-api.de/api/interpreter`
- Documentation :
  - https://wiki.openstreetmap.org/wiki/Overpass_API

Note d’usage :
- Les recommandations de l’instance publique indiquent des limites prudentes de requêtes/jour et de bande passante/jour.

## 5) Données d’altitude DEM (rendu des pentes/du relief)

- La compilation et l’exécution utilisent des tuiles `.hgt.zip` de type DEM3 et, en option, des tuiles `.hgt.gz` à 1 seconde d’arc.
- Source par défaut dans l’appli/la chaîne de compilation :
  - `https://download.mapsforge.org/maps/dem/dem3`
- Source facultative à 1 seconde d’arc :
  - Mapzen Terrain Tiles / AWS `skadi`
  - `https://s3.amazonaws.com/elevation-tiles-prod/skadi`
- Références :
  - https://download.mapsforge.org/maps/dem/
  - https://download.mapsforge.org/maps/dem/ReadMe.md
  - https://www.mapzen.com/blog/terrain-tile-service/
  - https://www.mapzen.com/rights/

## 6) Icônes POI

- Les icônes POI locales dérivent des ensembles SVG Maki et Temaki :
  - https://github.com/mapbox/maki
  - https://github.com/rapideditor/temaki
- La compilation peut aussi télécharger des icônes SVG Maki de secours depuis :
  - https://github.com/mapbox/maki
- Licence :
  - CC0 1.0 Universal
  - https://creativecommons.org/publicdomain/zero/1.0/

## 7) Ressources et segments d’itinéraire BRouter

- Profils de calcul intégrés :
  - `app/src/main/assets/brouter/profiles2/lookups.dat`
  - `app/src/main/assets/brouter/profiles2/hiking-mountain.brf`
- Source de téléchargement des segments dans le compagnon :
  - `https://brouter.de/brouter/segments4`
- Références d’origine :
  - https://github.com/abrensch/brouter
  - https://brouter.de/brouter/

Notes :
- BRouter indique que les segments `.rd5` sont générés à partir d’OpenStreetMap et mis à jour chaque semaine.
- L’attribution OpenStreetMap reste pertinente pour les données de segments.
- Le code BRouter est intégré séparément sous licence MIT dans l’appli montre ; voir la mention de licence dans `THIRD_PARTY_NOTICES.md`.

## 8) Fichiers importés par l’utilisateur

- L’appli accepte les fichiers de cartes/POI/GPX importés par l’utilisateur.
- Leurs licences et droits de redistribution restent de sa responsabilité.

## 9) Liste de contrôle pratique

- Garder un écran légal accessible depuis les paramètres de la montre.
- Garder `CREDITS_AND_THANKS.md` court et accessible.
- Synchroniser les documents juridiques détaillés avec les liens et API du compagnon.
- Revérifier les conditions à chaque changement d’URL de fournisseur ou de source d’import.
