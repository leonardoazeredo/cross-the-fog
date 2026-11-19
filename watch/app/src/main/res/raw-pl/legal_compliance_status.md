# Stan zgodności

Ostatni przegląd: 2026-05-07

Legenda stanów:
- `DONE`: wdrożone i zweryfikowane.
- `PENDING`: wymaga dalszych działań przed wydaniem lub po nim.
- `BLOCKER`: nie rozpowszechniać dołączonego zasobu bez rozwiązania problemu.

## Aktualna lista kontrolna

1. Informacje prawne dostępne z ustawień zegarka
   - Stan: `DONE`
   - Dowód: ekran `Settings -> Licenses` dostępny w aplikacji.

2. Przystępna strona autorów i podziękowań
   - Stan: `DONE`
   - Dowód: `licenses/CREDITS_AND_THANKS.md`.

3. Informacje o otwartych licencjach głównych bibliotek
   - Stan: `DONE`
   - Dowód: `licenses/THIRD_PARTY_NOTICES.md`.

4. Źródła danych i zasobów
   - Stan: `DONE`
   - Dowód: `licenses/DATA_AND_ASSET_ATTRIBUTION.md`.

5. Strona warunków usług/API
   - Stan: `DONE`
   - Dowód: `licenses/SERVICE_TERMS_AND_API_USAGE.md`.

6. Przejrzystość źródeł zewnętrznych aplikacji towarzyszącej
   - Stan: `DONE`
   - Dowód: `licenses/COMPANION_EXTERNAL_SOURCES.md`.

7. Limity użycia publicznej instancji Overpass
   - Stan: `PENDING`
   - Uwagi:
     - Zasady głównej instancji publicznej wskazują ostrożne limity (10 000 zapytań/dzień, <1 GB/dzień).
     - Monitorowanie i ograniczanie tempa importu powinno pozostać zachowawcze.

8. Weryfikacja licencji i rozpowszechniania dołączonego motywu OpenHiking
   - Stan: `DONE`
   - Dowód:
     - Właściciel projektu potwierdził 2026-04-26 otrzymanie zgody od OpenHiking.
     - Właściciel projektu potwierdził, że licencja motywu OpenHiking to `CC BY-SA`.
   - Uwagi:
     - Wersja OpenHiking jest teraz dołączona w `app/src/main/assets/theme/openhiking`.
     - Integracja ZIP motywu OpenHiking pozostaje opcjonalną ścieżką odświeżania w procesie kompilacji.
     - Sprawdzone archiwum ZIP nie zawierało jednoznacznego, osobnego pliku licencji/readme.
     - Zachowaj informacje o autorstwie i obowiązki share-alike w dokumentacji projektu.
     - Gdy będą dostępne, zarchiwizuj prywatnie dokładną stronę/wersję źródłową i szczegóły zgody.

## Warunki upublicznienia repozytorium i wydania

Przed upublicznieniem repozytorium lub wydaniem aplikacji rozwiąż wszystkie pozycje `BLOCKER`.
Nierozwiązane pozycje `PENDING` dotyczące rozpowszechniania/licencji dołączonych zasobów traktuj jako
blokujące, chyba że dane zasoby zostaną usunięte z publicznej gałęzi lub
pozostałe ryzyko zostanie wyraźnie zaakceptowane. Upublicznienie tego repozytorium
udostępnia też dołączone zasoby stron trzecich.

Bieżący wynik oceny:
- `READY FROM A BUNDLED-ASSET LICENSING STANDPOINT`, bez pozostałych odnotowanych przeszkód w rozpowszechnianiu obecnego zestawu motywów.
- OpenHiking nie stanowi już przeszkody na podstawie zapisanych potwierdzeń, gdzie mają zastosowanie, oraz obecnego niekomercyjnego modelu dystrybucji tam, gdzie jest istotny.
- Pozostałe zadania przed upublicznieniem to sprawy operacyjne w `docs/PUBLIC_REPO_CHECKLIST.md`, takie jak metadane GitHub, włączenie Pages i zgłaszanie problemów bezpieczeństwa.
