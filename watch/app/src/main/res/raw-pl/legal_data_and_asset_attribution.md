# Źródła danych i zasobów

Ostatni przegląd: 2026-05-07

Ten plik zawiera informacje o autorstwie i licencjach zasobów map innych niż kod, zbiorów danych i importowanych źródeł POI używanych przez GlanceMap.

## 1) Dane OpenStreetMap

- Zalecana treść informacji o autorstwie:
  - `Map data (c) OpenStreetMap contributors`
- Źródła:
  - https://www.openstreetmap.org/copyright
  - https://opendatacommons.org/licenses/odbl/1-0/

## 2) Motyw Mapsforge OpenHiking

- Lokalne dołączone pliki motywu:
  - `app/src/main/assets/theme/openhiking/OpenHiking.xml`
  - Drzewo zasobów `app/src/main/assets/theme/openhiking/`
- Przypięta wersja źródłowa w konfiguracji projektu:
  - `2026-02-10`
- Opcjonalne archiwum odświeżania podczas kompilacji:
  - `https://openhiking.eu/en/component/phocadownload/category/1-terkepek/6-mapsforge-stilus?Itemid=102&download=14:openhiking-terkep-stilus`
- Zawartość wyodrębnionego motywu sprawdzona 2026-03-14:
  - `OpenHiking/OpenHiking.xml`
  - Podkatalogi SVG/wzorów/symboli dołączone do ZIP.
- Źródła oryginalne:
  - https://openhiking.eu/en/downloads/mapsforge-maps
  - https://openhiking.eu/locus/Hungary.xml

Ważne:
- Pobrany ZIP nie zawierał jednoznacznego, osobnego pliku licencji/readme.
- Właściciel projektu potwierdził 2026-04-26 otrzymanie zgody od OpenHiking.
- Właściciel projektu potwierdził, że licencja motywu OpenHiking to `CC BY-SA`.
- Zachowaj informacje o autorstwie i obowiązki share-alike w dokumentacji projektu.
- Gdy będą dostępne, zarchiwizuj prywatnie dokładną stronę/wersję źródłową i szczegóły zgody.
- Informacja dla użytkowników jest dostępna w `licenses/OPENHIKING_THEME.md`.

## 3) Import danych Refuges.info

- Aplikacja towarzysząca importuje dane POI z:
  - `https://www.refuges.info/api/bbox`
  - `https://www.refuges.info/api/polygones`
- Źródło informacji o licencji:
  - https://www.refuges.info/wiki/licence

Uwagi:
- Refuges.info podaje licencję CC BY-SA dla treści stron punktów.
- Refuges.info wskazuje też dane OpenStreetMap i ograniczenia ODbL tam, gdzie mają zastosowanie.

## 4) Uzupełnianie POI OSM przez Overpass API

- Punkt dostępu do uzupełniania w aplikacji towarzyszącej:
  - `https://overpass-api.de/api/interpreter`
- Dokumentacja:
  - https://wiki.openstreetmap.org/wiki/Overpass_API

Informacja o użyciu:
- Wytyczne instancji publicznej wskazują ostrożne limity (zapytań/dzień i transferu/dzień).

## 5) Dane wysokości DEM (renderowanie nachylenia/cieniowania)

- Procesy kompilacji i działania używają kafelków typu DEM3 `.hgt.zip` i opcjonalnych kafelków `.hgt.gz` o rozdzielczości 1 sekundy łuku.
- Domyślne źródło w aplikacji/procesie kompilacji:
  - `https://download.mapsforge.org/maps/dem/dem3`
- Opcjonalne źródło o rozdzielczości 1 sekundy łuku:
  - Mapzen Terrain Tiles / AWS `skadi`
  - `https://s3.amazonaws.com/elevation-tiles-prod/skadi`
- Odnośniki:
  - https://download.mapsforge.org/maps/dem/
  - https://download.mapsforge.org/maps/dem/ReadMe.md
  - https://www.mapzen.com/blog/terrain-tile-service/
  - https://www.mapzen.com/rights/

## 6) Zasoby ikon POI

- Lokalne ikony źródłowe POI pochodzą z zestawów SVG Maki i Temaki:
  - https://github.com/mapbox/maki
  - https://github.com/rapideditor/temaki
- Proces kompilacji może też pobierać zapasowe ikony SVG Maki z:
  - https://github.com/mapbox/maki
- Licencja:
  - CC0 1.0 Universal
  - https://creativecommons.org/publicdomain/zero/1.0/

## 7) Zasoby i segmenty tras BRouter

- Dołączone zasoby profili tras:
  - `app/src/main/assets/brouter/profiles2/lookups.dat`
  - `app/src/main/assets/brouter/profiles2/hiking-mountain.brf`
- Źródło pobierania segmentów tras w aplikacji towarzyszącej:
  - `https://brouter.de/brouter/segments4`
- Źródła oryginalne:
  - https://github.com/abrensch/brouter
  - https://brouter.de/brouter/

Uwagi:
- Projekt BRouter podaje, że segmenty tras `.rd5` są generowane z danych OpenStreetMap i aktualizowane co tydzień.
- Uznanie autorstwa OpenStreetMap pozostaje istotne dla danych segmentów tras.
- Aplikacja na zegarek osobno dołącza kod BRouter na licencji MIT; informacja o licencji kodu znajduje się w `THIRD_PARTY_NOTICES.md`.

## 8) Pliki importowane przez użytkownika

- Aplikacja obsługuje importowane przez użytkownika pliki map/POI/GPX.
- Licencje i prawa do rozpowszechniania plików użytkownika pozostają jego odpowiedzialnością.

## 9) Praktyczna lista kontrolna zgodności

- Utrzymuj ekran prawny dostępny z ustawień zegarka.
- Zachowaj przystępność i zwięzłość `CREDITS_AND_THANKS.md`.
- Utrzymuj zgodność szczegółowej dokumentacji prawnej z odnośnikami zewnętrznymi i API aplikacji towarzyszącej.
- Sprawdzaj ponownie warunki przy każdej zmianie adresów dostawców lub źródeł importu.
