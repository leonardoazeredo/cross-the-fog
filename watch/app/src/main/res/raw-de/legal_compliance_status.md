# Konformitätsstatus

Zuletzt geprüft: 2026-05-07

Statuslegende:
- `DONE`: umgesetzt und geprüft.
- `PENDING`: Nachverfolgung vor/nach Veröffentlichung nötig.
- `BLOCKER`: enthaltene Ressource ohne Klärung nicht ausliefern.

## Aktuelle Prüfliste

1. Rechtliche Hinweise aus den Uhreinstellungen erreichbar
   - Status: `DONE`
   - Nachweis: Ansicht `Settings -> Licenses` in der App verfügbar.

2. Verständliche Seite mit Quellenangaben
   - Status: `DONE`
   - Nachweis: `licenses/CREDITS_AND_THANKS.md`.

3. Open-Source-Hinweise zu Kernbibliotheken
   - Status: `DONE`
   - Nachweis: `licenses/THIRD_PARTY_NOTICES.md`.

4. Daten- und Quellenangaben
   - Status: `DONE`
   - Nachweis: `licenses/DATA_AND_ASSET_ATTRIBUTION.md`.

5. Seite zu Dienst-/API-Bedingungen
   - Status: `DONE`
   - Nachweis: `licenses/SERVICE_TERMS_AND_API_USAGE.md`.

6. Transparenz externer Quellen der Begleit-App
   - Status: `DONE`
   - Nachweis: `licenses/COMPANION_EXTERNAL_SOURCES.md`.

7. Nutzungsgrenzen der öffentlichen Overpass-Instanz
   - Status: `PENDING`
   - Hinweise:
     - Die öffentliche Hauptrichtlinie nennt vorsichtige Grenzen (10000 Abfragen/Tag, <1 GB/Tag).
     - Abfrage-/Importdrosselung weiterhin vorsichtig halten.

8. Lizenz-/Weiterverteilungsprüfung des enthaltenen OpenHiking-Themas
   - Status: `DONE`
   - Nachweis:
     - Der Projektverantwortliche bestätigte am 2026-04-26 die Genehmigung von OpenHiking.
     - Der Projektverantwortliche bestätigte `CC BY-SA` als Lizenz des OpenHiking-Themas.
   - Hinweise:
     - Der OpenHiking-Stand ist jetzt in `app/src/main/assets/theme/openhiking` enthalten.
     - Die ZIP-Integration des OpenHiking-Themas bleibt als optionaler Aktualisierungsweg im Build verfügbar.
     - Das untersuchte ZIP enthielt keine erkennbare separate Lizenz-/Readme-Datei.
     - Quellenangaben und Weitergabe-unter-gleichen-Bedingungen-Pflichten in der Projektdokumentation beibehalten.
     - Genaue ursprüngliche Seite/Version und Genehmigungsdetails privat archivieren, sobald verfügbar.

## Freigabekriterien für öffentliches Repository und Veröffentlichung

Für ein öffentliches Repository oder eine öffentliche App-Veröffentlichung alle `BLOCKER`-Punkte lösen.
Offene `PENDING`-Punkte zu Lizenz/Weiterverteilung enthaltener Ressourcen gelten als
blockierend, sofern betroffene Ressourcen nicht aus dem öffentlichen Branch entfernt werden oder
das Restrisiko ausdrücklich akzeptiert wird. Eine Veröffentlichung dieses Repositorys
veröffentlicht auch die enthaltenen Ressourcen Dritter.

Aktuelles Freigabeergebnis:
- `READY FROM A BUNDLED-ASSET LICENSING STANDPOINT`, ohne verbleibende dokumentierte Weiterverteilungsblocker für die aktuellen Themen.
- OpenHiking ist aufgrund dokumentierter Bestätigungen und des aktuellen nichtkommerziellen Modells, soweit zutreffend, kein Blocker mehr.
- Verbleibende Aufgaben vor Veröffentlichung sind operative Punkte in `docs/PUBLIC_REPO_CHECKLIST.md`, etwa GitHub-Metadaten, Pages-Aktivierung und Sicherheitsmeldungen.
