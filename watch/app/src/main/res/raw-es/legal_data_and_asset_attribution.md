# Atribución de datos y recursos

Última revisión: 2026-05-07

Este archivo documenta atribución y licencias de recursos cartográficos no ejecutables, conjuntos de datos y fuentes POI importadas usados por GlanceMap.

## 1) Datos de OpenStreetMap

- Texto de atribución recomendado:
  - `Map data (c) OpenStreetMap contributors`
- Fuentes:
  - https://www.openstreetmap.org/copyright
  - https://opendatacommons.org/licenses/odbl/1-0/

## 2) Tema Mapsforge OpenHiking

- Archivos locales del tema incluido:
  - `app/src/main/assets/theme/openhiking/OpenHiking.xml`
  - Árbol de recursos `app/src/main/assets/theme/openhiking/`
- Versión original fijada en la configuración:
  - `2026-02-10`
- Archivo opcional para actualizar durante la compilación:
  - `https://openhiking.eu/en/component/phocadownload/category/1-terkepek/6-mapsforge-stilus?Itemid=102&download=14:openhiking-terkep-stilus`
- Contenido del tema extraído observado el 2026-03-14:
  - `OpenHiking/OpenHiking.xml`
  - Subcarpetas SVG, patrones y símbolos incluidas en el ZIP.
- Referencias originales:
  - https://openhiking.eu/en/downloads/mapsforge-maps
  - https://openhiking.eu/locus/Hungary.xml

Importante:
- El ZIP descargado no contenía un archivo independiente evidente de licencia o instrucciones.
- El responsable del proyecto confirmó el 2026-04-26 la aprobación de OpenHiking.
- El responsable del proyecto confirmó que la licencia del tema OpenHiking es `CC BY-SA`.
- Conservar atribución y obligaciones de compartir igual en la documentación del proyecto.
- Archivar en privado la página o versión original exacta y los detalles de aprobación cuando estén disponibles.
- Nota para usuarios disponible en `licenses/OPENHIKING_THEME.md`.

## 3) Importaciones de datos Refuges.info

- La app del teléfono importa datos POI de:
  - `https://www.refuges.info/api/bbox`
  - `https://www.refuges.info/api/polygones`
- Referencia de licencia:
  - https://www.refuges.info/wiki/licence

Notas:
- Refuges.info indica que el contenido de las páginas de puntos está bajo CC BY-SA.
- Refuges.info también remite a los datos OpenStreetMap y a las restricciones ODbL cuando corresponda.

## 4) Ampliación de POI OSM mediante Overpass API

- Punto de acceso usado por la app del teléfono:
  - `https://overpass-api.de/api/interpreter`
- Documentación:
  - https://wiki.openstreetmap.org/wiki/Overpass_API

Nota de uso:
- Las instrucciones de la instancia pública indican límites prudentes de consultas y ancho de banda diarios.

## 5) Datos de altitud DEM (dibujo de pendientes y relieve)

- La compilación y la app usan teselas `.hgt.zip` de tipo DEM3 y, opcionalmente, teselas `.hgt.gz` de 1 segundo de arco.
- Fuente predeterminada de la app y la compilación:
  - `https://download.mapsforge.org/maps/dem/dem3`
- Fuente opcional de 1 segundo de arco:
  - Mapzen Terrain Tiles / AWS `skadi`
  - `https://s3.amazonaws.com/elevation-tiles-prod/skadi`
- Referencias:
  - https://download.mapsforge.org/maps/dem/
  - https://download.mapsforge.org/maps/dem/ReadMe.md
  - https://www.mapzen.com/blog/terrain-tile-service/
  - https://www.mapzen.com/rights/

## 6) Recursos de iconos POI

- Los iconos POI locales derivan de los conjuntos SVG Maki y Temaki:
  - https://github.com/mapbox/maki
  - https://github.com/rapideditor/temaki
- La compilación también puede descargar iconos SVG Maki de respaldo desde:
  - https://github.com/mapbox/maki
- Licencia:
  - CC0 1.0 Universal
  - https://creativecommons.org/publicdomain/zero/1.0/

## 7) Recursos y segmentos de rutas BRouter

- Recursos de perfiles de rutas incluidos:
  - `app/src/main/assets/brouter/profiles2/lookups.dat`
  - `app/src/main/assets/brouter/profiles2/hiking-mountain.brf`
- Fuente de descarga de segmentos de rutas en la app del teléfono:
  - `https://brouter.de/brouter/segments4`
- Referencias originales:
  - https://github.com/abrensch/brouter
  - https://brouter.de/brouter/

Notas:
- BRouter indica que los segmentos de rutas `.rd5` se generan a partir de datos OpenStreetMap y se actualizan semanalmente.
- La atribución OpenStreetMap sigue siendo pertinente para los datos de segmentos de rutas.
- La app del reloj incorpora el código BRouter por separado bajo la licencia MIT; consulta el aviso de licencia del código en `THIRD_PARTY_NOTICES.md`.

## 8) Archivos importados por el usuario

- La app admite mapas, POI y archivos GPX importados por el usuario.
- Las licencias y los derechos de redistribución de los archivos aportados siguen siendo responsabilidad del usuario.

## 9) Lista práctica de cumplimiento

- Mantener una pantalla legal accesible desde los ajustes del reloj.
- Mantener `CREDITS_AND_THANKS.md` breve y comprensible.
- Sincronizar la documentación legal detallada con los enlaces y API externos de la app del teléfono.
- Revisar las condiciones cuando cambien URL de proveedores o fuentes de importación.
