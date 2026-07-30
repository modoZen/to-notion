# SPEC 05 — CLI de orquestación end-to-end (sync)

> **Status:** Implementado
> **Depends on:** SPEC 01 (`convertDocx`), SPEC 02 (`mdToBlocks` vía `pushModule`), SPEC 03 (`notion`, `loadState`/`saveState`, `pushModule`)
> **Date:** 2026-07-30
> **Objective:** Agregar `src/cli/sync.ts` (`npm run sync`), el CLI que convierte un `.docx` completo y sube todos sus módulos a Notion en una sola corrida (o uno puntual con `MODULO_N`), incluyendo `--dry-run` y el chequeo de acceso a la página padre — cerrando los dos riesgos que SPEC 03 dejó documentados como pendientes para esta spec.

---

## Scope

**In:**

- `src/cli/sync.ts`, con parseo manual de argv (mismo criterio de cero dependencias que `convert.ts`/`blocks.ts`/`push.ts`): posicionales `<archivo.docx> <PARENT_PAGE_ID> [MODULO_N]` + flag `--dry-run` en cualquier posición.
- Una función exportada y testeable (ej. `runSync(options)`) separada del `main()`/parseo de argv, viviendo en el propio `src/cli/sync.ts` — no se crea un `src/sync/` nuevo solo para una función que orquesta módulos ya existentes de `docx-to-md` y `notion-client`.
- Comportamiento, puerto fiel del prototipo (`references/notion-sync.js` líneas 1494-1546):
  1. `loadEnv()`.
  2. Si falta `docx` o `parentId`: imprime uso y `exit 1`.
  3. Si el `.docx` no existe en disco: error claro y `exit 1` (chequeo explícito antes de invocar pandoc, igual que el prototipo).
  4. `convertDocx({ docxPath })` **siempre**, sin gating por `--dry-run` (es local y cacheado — mismo criterio que hoy en `convert.ts`; `--dry-run` solo afecta las etapas que tocan la red).
  5. Usa `manifest.modules` (ya devuelto por `convertDocx`) directo como lista de `PushModuleInput` — sin releer `manifest.json` a mano ni pasar por `resolvePushModuleInput`.
  6. Si viene `MODULO_N`: filtra `manifest.modules` por ese número; si no hay match, error `"No hay módulo N. Van del 1 al <total>."` + `exit 1`, antes de tocar la red.
  7. Si `!dryRun`: chequeo de acceso al padre vía `notion('GET', '/pages/' + parentId sin guiones)`; imprime el título del padre. Si falla: mensaje de ayuda (token de integración, página compartida, id correcto) + `exit 1`. Se salta por completo si `dryRun`.
  8. `loadState(outDir)`, luego recorre los módulos filtrados **en orden** llamando a `pushModule(mod, ruta.md, mediaDir, parentId, outDir, state, dryRun)` — sin `try/catch` por módulo: un error aborta el resto (decidido).
  9. Logging mínimo en español: nombre del padre (si se chequeó), `"Subiendo N módulo(s)"` (+ `" (simulación)"` si `dryRun`), `"Listo."` al final.
- `outDir`/`modulesDir`/`mediaDir` derivados igual que `convert.ts` (`workspace/<slug>/`, `workspace/<slug>/modules/`, `workspace/<slug>/media/`).
- Script `"sync": "node src/cli/sync.ts"` en `package.json`.
- Tests en `src/cli/__tests__/sync.test.ts`, con `convertDocx`, `notion`, `loadState`, `pushModule` mockeados (`vi.mock`): `MODULO_N` válido filtra a un solo módulo; `MODULO_N` inválido produce el mensaje exacto y no llama a `pushModule` ni a `notion`; `--dry-run` salta el chequeo de padre; chequeo de padre exitoso imprime el nombre y sigue; chequeo de padre fallido aborta antes de cualquier `pushModule`; un error de `pushModule` en el módulo N aborta sin llamar a los módulos siguientes.
- `README.md`: reemplaza la frase actual ("Todavía no existe un CLI que recorra todos los módulos... eso es SPEC 05 en adelante") por la descripción real del comando, agrega `sync.ts` a la tabla de `src/cli/`, y actualiza "Instalar y correr" con el ejemplo de uso.

**Out of scope (para specs futuras):**

- Registro de cursos / `course-registry.json` (SPEC 06).
- Creación de filas de curso en la base `Cursos` (SPEC 07, fase 2).
- `@notionhq/client` u otro SDK oficial de Notion.
- Tests contra la API real de Notion en CI — validación manual, mismo criterio que SPEC 01-04.
- El bug de archivado de páginas a medias en `push-module.ts` (anotado como pendiente en los Risks de SPEC 04) — preexistente, no se toca acá.
- Reporte de módulos fallidos al final de la corrida con continuación del resto (se descartó explícitamente: la corrida aborta entera ante el primer error).

---

## Data model

No se introduce ninguna estructura de datos nueva persistida — se reutilizan `Manifest`/`ConvertedModule` (SPEC 01) y `SyncState` (SPEC 03) tal cual. Lo único nuevo es la firma de la función exportada de orquestación:

```ts
// src/cli/sync.ts

export interface RunSyncOptions {
  docxPath: string;
  parentId: string;
  moduleNumber?: number; // MODULO_N parseado; ausente = todos los módulos
  dryRun: boolean;
}

export async function runSync(options: RunSyncOptions): Promise<void>;

// parseo de argv, separado de runSync para poder testear runSync sin pasar por process.argv
function parseArgv(argv: string[]): RunSyncOptions | null; // null = uso inválido (falta docx o parentId)
```

Conventions:

- `RunSyncOptions` es deliberadamente plano (4 campos), sin reusar `ConvertOptions` de SPEC 01 (que tiene `workspaceRoot`/`keepIndex`, no relevantes acá) ni inventar un tipo compartido con `PushModuleInput` — mismo criterio de "mínimo necesario por función" ya usado en `PushModuleInput` (SPEC 03).
- `parseArgv` separa el parseo de flags/posicionales de `runSync`, igual que `push.ts` separa `parseFlags` de la lógica principal — permite testear `runSync` pasando un `RunSyncOptions` armado a mano, sin mockear `process.argv`.
- El chequeo "¿existe `MODULO_N`?" vive **dentro** de `runSync` (no en `parseArgv`), porque necesita el `Manifest` ya cargado (devuelto por `convertDocx`) para saber el total de módulos y armar el mensaje de error.

---

## Implementation plan

1. `src/cli/sync.ts`: `parseArgv(argv)` + `runSync(options)` completo (validación de docx/parentId, chequeo de archivo en disco, `convertDocx`, filtro por `MODULO_N`, chequeo de acceso al padre condicionado a `!dryRun`, loop de `pushModule` sin `try/catch` individual, logging mínimo) + `main()` que conecta `parseArgv(process.argv.slice(2))` con `runSync`. Tests en `src/cli/__tests__/sync.test.ts` con `vi.mock` de `../docx-to-md/convert.ts`, `../notion-client/client.ts`, `../notion-client/state.ts` y `../notion-client/push-module.ts`: `MODULO_N` válido filtra a un solo módulo y llama `pushModule` una sola vez; `MODULO_N` inválido produce `"No hay módulo N. Van del 1 al <total>."` y no llama a `notion` ni a `pushModule`; `--dry-run` salta el chequeo de padre (no llama a `notion`) pero sí llama a `pushModule` con `dryRun: true` para cada módulo; chequeo de padre exitoso permite continuar al loop; chequeo de padre fallido lanza antes de cualquier `pushModule`; `pushModule` que rechaza en el módulo N aborta sin llamar a los módulos siguientes; falta `docx` o `parentId` en `parseArgv` devuelve `null`; `.docx` inexistente en disco lanza error claro.
2. `package.json`: agregar `"sync": "node src/cli/sync.ts"` a `scripts`, mismo patrón que `convert`/`blocks`/`push`.
3. `README.md`: reemplazar la frase "Todavía no existe un CLI que recorra todos los módulos de un curso de punta a punta: eso es SPEC 05 en adelante" por la descripción real de `npm run sync`; agregar la fila de `sync.ts` a la tabla de `src/cli/`; agregar el ejemplo de uso (`npm run sync -- <ruta.docx> <PARENT_PAGE_ID> [MODULO_N] [--dry-run]`) a la sección "Instalar y correr", junto con una explicación breve igual de detallada que la que ya existe para `npm run push`.
4. Verificación manual real (no en CI, mismo criterio que SPEC 01-04): correr `npm run sync -- <docx-de-un-curso-real> <PARENT_PAGE_ID>` de punta a punta contra una página padre real de Notion y confirmar visualmente que todos los módulos aparecen como subpáginas. Correr la misma corrida de nuevo y confirmar que cada módulo se saltea con el log `"— ya estaba subido, se salta"` (heredado de `pushModule`, SPEC 03) sin ninguna llamada de red — este es el caso limpio, y es criterio de aceptación verificable. Correr con un `MODULO_N` puntual y confirmar que solo ese módulo se sube/rehace. Si durante la prueba aparece un módulo con intento previo incompleto (`pageId` sin `done`), se documenta como manifestación del bug de archivado ya conocido (Risks de SPEC 04) — riesgo heredado, no bloquea esta spec ni se arregla acá.

---

## Acceptance criteria

- [x] `npm run typecheck` y `npm test` pasan sin errores con los archivos nuevos (`src/cli/sync.ts`, `src/cli/__tests__/sync.test.ts`).
- [x] `runSync` con `MODULO_N` válido llama a `pushModule` exactamente una vez, con el módulo correcto. (Test.)
- [x] `runSync` con `MODULO_N` inválido produce el error `"No hay módulo N. Van del 1 al <total>."`, y no llama a `notion` ni a `pushModule`. (Test.)
- [x] `runSync` con `--dry-run` no llama a `notion` (chequeo de padre salteado) pero sí llama a `pushModule` con `dryRun: true` para cada módulo filtrado. (Test.)
- [x] `runSync` sin `--dry-run` llama a `notion('GET', '/pages/...')` antes de cualquier `pushModule`; si esa llamada falla, aborta sin llamar a `pushModule`. (Test.)
- [x] `runSync` con más de un módulo aborta el resto del loop si `pushModule` rechaza en un módulo intermedio — no se llama a `pushModule` para los módulos siguientes al que falló. (Test.)
- [x] `parseArgv` devuelve `null` si falta `docx` o `parentId`; reconoce `MODULO_N` y `--dry-run` en cualquier posición. (Test.)
- [x] `runSync` lanza un error claro si el `.docx` no existe en disco, antes de invocar `convertDocx`. (Test.)
- [x] `npm run sync -- <docx-real> <PARENT_PAGE_ID>` corrido a mano contra un curso real y una página padre real de Notion sube todos los módulos como subpáginas — confirmado visualmente. (Verificado a mano, no en CI.)
- [x] Repetir la misma corrida: cada módulo se saltea con el log `"— ya estaba subido, se salta"`, sin ninguna llamada de red (verificado por ausencia de nuevas páginas/cambios en Notion). (Verificado a mano.)
- [x] `npm run sync -- <docx-real> <PARENT_PAGE_ID> N` sube o rehace solo el módulo `N`, dejando el resto sin tocar. (Verificado a mano.)
- [x] `README.md` refleja el CLI real (`npm run sync`) en vez de la frase "todavía no existe", incluye `sync.ts` en la tabla de `src/cli/` y el ejemplo de uso en "Instalar y correr".
- [x] `package.json` tiene el script `"sync": "node src/cli/sync.ts"`.

---

## Decisions

- **Sí:** `src/cli/sync.ts` sigue la convención existente de `src/cli/` (un archivo por comando + `npm run <nombre>`), en vez del path literal `src/cli.ts` dado en el prompt inicial. Consistente con `convert.ts`/`blocks.ts`/`push.ts`.
- **Sí:** incluir `--dry-run` en el CLI completo, tal como SPEC 03 lo dejó anotado como responsabilidad de esta spec. Afecta el chequeo de padre (se saltea) y se propaga a cada `pushModule`; **no** afecta si se convierte el `.docx` — `convertDocx` corre siempre porque es local y cacheado, igual que el prototipo.
- **Sí:** portar el chequeo de acceso a la página padre (`GET /pages/:id` con mensaje de ayuda) del prototipo, también anotado en SPEC 03 como responsabilidad de esta spec.
- **Sí:** un error de `pushModule` a mitad de la corrida aborta el resto (mismo comportamiento que el prototipo — el error se propaga y el proceso termina con `exit 1`). Los módulos ya subidos quedan `done` en el estado (SPEC 03); una nueva corrida resume donde quedó. **No** se agrega recolección de errores por módulo con reporte al final — cambiaría el comportamiento ya validado del prototipo sin necesidad real.
- **Sí:** la lógica de orquestación (`runSync`) vive como función exportada dentro del propio `src/cli/sync.ts`, separada del parseo de argv (`parseArgv`) y de `main()`, con tests que mockean `convertDocx`/`notion`/`loadState`/`pushModule`. **No** se crea un módulo `src/sync/` nuevo — `runSync` solo coordina piezas que ya existen en `docx-to-md` y `notion-client`, no introduce lógica de dominio propia que justifique un paquete separado.
- **Sí:** `manifest.modules` (devuelto directo por `convertDocx`) se usa tal cual como lista de `PushModuleInput` — **no** se pasa por `resolvePushModuleInput` de `push.ts`, que existe solo para el caso sin manifest (módulo suelto, sin conversión previa en la misma corrida).
- **Sí:** `outDir`/`modulesDir`/`mediaDir` derivados con la misma convención `workspace/<slug>/` ya usada por `convert.ts`/`push.ts` (vía `convertDocx`), **no** la convención `<docx>.notion/` del prototipo original.
- **No:** arreglar en esta spec el bug conocido de archivado de páginas a medias en `push-module.ts` (documentado en Risks de SPEC 04). Sigue como riesgo heredado, pendiente de una spec chica dedicada.
- **No:** tests contra la API real de Notion en CI — misma validación manual documentada en Acceptance criteria, igual que SPEC 01-04.
- **No:** `@notionhq/client` u otro SDK oficial de Notion — se mantiene fetch nativo, consistente con SPEC 02/03.

---

## Risks

| Risk                                                                                                                                                                                                                                                                                                               | Mitigation                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El bug conocido de archivado a medias en `push-module.ts` (Risks de SPEC 04) tiene más impacto acá que en `push.ts`: como `sync` aborta el resto de la corrida ante cualquier error de `pushModule`, un solo módulo con intento previo incompleto puede detener la subida de todo el curso, no solo de ese módulo. | Documentado explícitamente en Decisions y en el paso 4 del plan como riesgo heredado, no de esta spec. Si bloquea una corrida real, la vía de escape manual ya usada en SPEC 04 (borrar la página vieja a mano en Notion y limpiar la entrada en `.notion-sync-state.json`) sigue siendo válida hasta que exista la spec chica dedicada al arreglo. |
| Abortar toda la corrida ante el primer error de `pushModule` (decidido) significa que un problema transitorio de red en el módulo 5 de 11 detiene también los módulos 6-11, aunque no tengan relación con la falla.                                                                                                | Es un trade-off aceptado explícitamente (Decisions), igual al comportamiento del prototipo. El estado ya guardado (SPEC 03) permite resumir con una nueva corrida sin reprocesar los módulos ya `done`.                                                                                                                                             |
| El chequeo de acceso al padre (`GET /pages/:id`) puede pasar aunque la integración solo tenga permiso de lectura, no de escritura — el error real recién aparece al intentar crear la primera página.                                                                                                              | Aceptado sin mitigación adicional: el error de creación ya usa el formato de mensaje existente de `notion()` (SPEC 03), suficiente para diagnosticar. No se agrega un chequeo de permisos de escritura separado, que la API de Notion no expone de forma directa.                                                                                   |

---

## What is **not** in this spec

- Registro de cursos / `course-registry.json` (otra spec, SPEC 06).
- Creación de filas de curso en la base `Cursos` (fase 2, SPEC 07).
- `@notionhq/client` u otro SDK oficial de Notion.
- Tests contra la API real de Notion en CI.
- El bug de archivado de páginas a medias en `push-module.ts` (otra spec, si se prioriza).
- Reporte de módulos fallidos al final de la corrida con continuación del resto.

Cada uno de estos, si se implementa, va en su propia spec.
