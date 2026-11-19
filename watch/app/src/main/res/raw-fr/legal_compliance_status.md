# État de conformité

Dernière révision : 2026-05-07

Légende :
- `DONE` : réalisé et vérifié.
- `PENDING` : suivi nécessaire avant/après publication.
- `BLOCKER` : ne pas distribuer une ressource intégrée avant résolution.

## Liste de contrôle actuelle

1. Accès aux mentions légales depuis les paramètres de la montre
   - État : `DONE`
   - Preuve : écran `Settings -> Licenses` disponible dans l’appli.

2. Page de crédits accessible aux utilisateurs
   - État : `DONE`
   - Preuve : `licenses/CREDITS_AND_THANKS.md`.

3. Mentions des bibliothèques libres principales
   - État : `DONE`
   - Preuve : `licenses/THIRD_PARTY_NOTICES.md`.

4. Attribution des données et ressources
   - État : `DONE`
   - Preuve : `licenses/DATA_AND_ASSET_ATTRIBUTION.md`.

5. Page des conditions des services/API
   - État : `DONE`
   - Preuve : `licenses/SERVICE_TERMS_AND_API_USAGE.md`.

6. Transparence sur les sources externes du compagnon
   - État : `DONE`
   - Preuve : `licenses/COMPANION_EXTERNAL_SOURCES.md`.

7. Limites d’usage de l’instance publique Overpass
   - État : `PENDING`
   - Notes :
     - La politique publique principale indique des limites prudentes (10 000 requêtes/jour, <1 GB/jour).
     - La surveillance et la limitation des imports doivent rester prudentes.

8. Vérification de la redistribution/licence du thème OpenHiking intégré
   - État : `DONE`
   - Preuve :
     - Le responsable du projet a confirmé le 2026-04-26 avoir reçu l’accord d’OpenHiking.
     - Le responsable du projet a confirmé la licence `CC BY-SA` du thème.
   - Notes :
     - La copie OpenHiking est intégrée dans `app/src/main/assets/theme/openhiking`.
     - L’intégration du ZIP OpenHiking reste une voie facultative d’actualisation dans la chaîne de compilation.
     - Le ZIP observé ne contenait pas de fichier de licence/readme distinct clairement identifiable.
     - Conserver les obligations d’attribution et de partage à l’identique dans la documentation.
     - Archiver en privé la page/version d’origine exacte et les détails de l’accord lorsqu’ils sont disponibles.

## Conditions de publication du dépôt et de l’appli

Pour un dépôt ou une appli publics, résoudre tous les points `BLOCKER`.
Traiter les points `PENDING` non résolus de redistribution/licence des ressources intégrées comme bloquants, sauf retrait des ressources concernées de la branche publique ou acceptation explicite du risque résiduel. Rendre le dépôt public publie aussi les ressources tierces intégrées.

Résultat actuel :
- `READY FROM A BUNDLED-ASSET LICENSING STANDPOINT`, sans blocage de redistribution encore consigné pour l’ensemble actuel de thèmes.
- OpenHiking n’est plus bloquant, sur la base des confirmations consignées lorsqu’elles s’appliquent et du modèle non commercial actuel lorsqu’il est pertinent.
- Les tâches restantes avant publication sont opérationnelles, dans `docs/PUBLIC_REPO_CHECKLIST.md`, notamment les métadonnées GitHub, l’activation de Pages et le signalement de sécurité.
