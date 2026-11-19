# Stato di conformità

Ultima revisione: 2026-05-07

Legenda stati:
- `DONE`: implementato e verificato.
- `PENDING`: richiede verifiche prima/dopo il rilascio.
- `BLOCKER`: non distribuire una risorsa inclusa senza risolvere il problema.

## Lista di verifica attuale

1. Voce legale accessibile dalle impostazioni dell'orologio
   - Stato: `DONE`
   - Prova: schermata `Settings -> Licenses` disponibile nell'app.

2. Pagina crediti comprensibile
   - Stato: `DONE`
   - Prova: `licenses/CREDITS_AND_THANKS.md`.

3. Avvisi open source per le librerie principali
   - Stato: `DONE`
   - Prova: `licenses/THIRD_PARTY_NOTICES.md`.

4. Attribuzione dati e risorse
   - Stato: `DONE`
   - Prova: `licenses/DATA_AND_ASSET_ATTRIBUTION.md`.

5. Pagina condizioni servizi/API
   - Stato: `DONE`
   - Prova: `licenses/SERVICE_TERMS_AND_API_USAGE.md`.

6. Trasparenza fonti esterne dell'app companion
   - Stato: `DONE`
   - Prova: `licenses/COMPANION_EXTERNAL_SOURCES.md`.

7. Limiti d'uso dell'istanza pubblica Overpass
   - Stato: `PENDING`
   - Note:
     - La politica pubblica principale indica limiti prudenti (10000 richieste/giorno, <1 GB/giorno).
     - Mantenere prudente la limitazione di richieste e importazioni.

8. Verifica licenza/ridistribuzione del tema OpenHiking incluso
   - Stato: `DONE`
   - Prova:
     - Il responsabile del progetto ha confermato il 2026-04-26 l'approvazione di OpenHiking.
     - Il responsabile del progetto ha confermato che la licenza del tema OpenHiking è `CC BY-SA`.
   - Note:
     - La copia OpenHiking è ora inclusa in `app/src/main/assets/theme/openhiking`.
     - L'integrazione ZIP del tema OpenHiking resta disponibile come aggiornamento opzionale nella compilazione.
     - Lo ZIP esaminato non includeva un evidente file licenza/readme separato.
     - Conservare attribuzione e obblighi di condivisione allo stesso modo nella documentazione del progetto.
     - Archiviare privatamente pagina/versione originale esatta e dettagli dell'approvazione, quando disponibili.

## Criteri per repository pubblico e rilascio

Per un repository o rilascio pubblico dell'app, risolvere tutti gli elementi `BLOCKER`.
Considerare bloccanti gli elementi `PENDING` irrisolti su licenza/ridistribuzione delle risorse incluse
salvo rimuovere le risorse interessate dal ramo pubblico o
accettare esplicitamente il rischio residuo. Pubblicare questo repository
pubblica anche le risorse di terzi incluse.

Esito attuale:
- `READY FROM A BUNDLED-ASSET LICENSING STANDPOINT`, senza blocchi di ridistribuzione registrati ancora aperti per i temi attuali.
- OpenHiking non è più un blocco, in base alle conferme registrate e all'attuale modello non commerciale ove pertinente.
- Le attività residue prima della pubblicazione sono operative e descritte in `docs/PUBLIC_REPO_CHECKLIST.md`, come metadati GitHub, attivazione Pages e segnalazioni di sicurezza.
