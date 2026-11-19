# Estado de cumplimiento

Última revisión: 2026-05-07

Leyenda de estados:
- `DONE`: implementado y verificado.
- `PENDING`: requiere seguimiento antes o después de publicar.
- `BLOCKER`: no distribuir un recurso incluido sin resolverlo.

## Lista actual de comprobaciones

1. Acceso legal para usuarios desde los ajustes del reloj
   - Estado: `DONE`
   - Prueba: pantalla `Settings -> Licenses` disponible en la app.

2. Página de créditos comprensible
   - Estado: `DONE`
   - Prueba: `licenses/CREDITS_AND_THANKS.md`.

3. Avisos de código abierto de las bibliotecas principales
   - Estado: `DONE`
   - Prueba: `licenses/THIRD_PARTY_NOTICES.md`.

4. Atribución de datos y recursos
   - Estado: `DONE`
   - Prueba: `licenses/DATA_AND_ASSET_ATTRIBUTION.md`.

5. Página de condiciones de servicios y API
   - Estado: `DONE`
   - Prueba: `licenses/SERVICE_TERMS_AND_API_USAGE.md`.

6. Transparencia de fuentes externas de la app del teléfono
   - Estado: `DONE`
   - Prueba: `licenses/COMPANION_EXTERNAL_SOURCES.md`.

7. Límites de uso de la instancia pública Overpass
   - Estado: `PENDING`
   - Notas:
     - La política pública principal indica límites prudentes (10000 consultas/día, <1 GB/día).
     - Mantener prudente la limitación de consultas e importaciones.

8. Verificación de licencia y redistribución del tema OpenHiking incluido
   - Estado: `DONE`
   - Prueba:
     - El responsable del proyecto confirmó el 2026-04-26 la aprobación de OpenHiking.
     - El responsable del proyecto confirmó que la licencia del tema OpenHiking es `CC BY-SA`.
   - Notas:
     - La copia de OpenHiking está incluida en `app/src/main/assets/theme/openhiking`.
     - La integración ZIP del tema OpenHiking sigue disponible como actualización opcional en la compilación.
     - El ZIP examinado no contenía un archivo independiente evidente de licencia o instrucciones.
     - Conservar atribución y obligaciones de compartir igual en la documentación del proyecto.
     - Archivar en privado la página o versión original exacta y los detalles de aprobación cuando estén disponibles.

## Condiciones para repositorio público y publicación

Para publicar el repositorio o la app, resolver todos los elementos `BLOCKER`.
Considerar bloqueantes los elementos `PENDING` de licencia o redistribución de recursos incluidos
salvo que los recursos afectados se retiren de la rama pública o que
se acepte expresamente el riesgo residual. Publicar el repositorio también
publica los recursos de terceros incluidos.

Resultado actual:
- `READY FROM A BUNDLED-ASSET LICENSING STANDPOINT`, sin bloqueos registrados de redistribución pendientes para los temas actuales.
- OpenHiking ya no bloquea, según las confirmaciones registradas y el modelo no comercial actual, donde corresponda.
- Las tareas previas a la publicación restantes son operativas y figuran en `docs/PUBLIC_REPO_CHECKLIST.md`, como metadatos GitHub, activar Pages y comunicar problemas de seguridad.
