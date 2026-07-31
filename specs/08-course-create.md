# SPEC 08 — Creación automática de curso (course.create)

> **Status:** Implementado
> **Depends on:** SPEC 01 (`slugify` en `src/docx-to-md/modules.ts`), SPEC 03 (`notion`, `loadEnv`, patrón `load*`/`save*`), SPEC 05 (`runSync` en `src/cli/sync.ts`), SPEC 07 (`registry.ts`: `loadRegistry`/`saveRegistry`/`upsertCourse`)
> **Date:** 2026-07-30
> **Objective:** Agregar un CLI nuevo (`sync-course`) que resuelve el parent de un curso automáticamente antes de subir sus módulos — usando el `pageId` ya registrado si el slug es conocido, o creando la fila en la base `Cursos` de Notion (con `--area`/`--plataforma` obligatorios) si es la primera vez — delegando siempre en el `runSync` ya existente para la subida de módulos en sí.

---

## Scope

**In:**

- Nuevo módulo `src/notion-client/hash.ts`: `hashFile(path: string): string` — sha256 hex sobre el contenido completo del archivo (`readFileSync` + `createHash('sha256')`, sin streaming — los `.docx` de curso pesan pocos MB).
- Nuevo módulo `src/notion-client/course.ts`: `createCourse(databaseId: string, properties: CourseProperties): Promise<string>` — `POST /pages` con `parent: { database_id }` y las properties ya armadas, devuelve el `pageId` de la fila creada. No arma las properties (esa lógica vive en `sync-course.ts`), solo hace la llamada de red.
- Nuevo CLI `src/cli/sync-course.ts`:
  `npm run sync-course -- <archivo.docx> [MODULO_N] --area <area> --plataforma <plataforma> [--estado <estado>] [--titulo <titulo>] [--dry-run] [--force]`
  - Calcula `slug` (reusa `slugify` de `docx-to-md/modules.ts`, sin recalcular distinto) y `docxHash` (`hashFile`).
  - `loadRegistry(workspaceRoot)` (default `"workspace"`, mismo default que `convertDocx`/`registry.ts`).
  - **Slug ya registrado:** usa `registry[slug].pageId` como parent. `--area`/`--plataforma`/`--estado`/`--titulo` no hace falta pasarlos; si se pasan, se ignoran (no se re-escriben esas properties sobre una fila ya creada).
  - **Slug nuevo:** requiere `--area` y `--plataforma` (error de uso claro + `exit 1` si faltan, antes de tocar la red). Arma las properties (`Título`, `Área`, `Plataforma`, `Estado`, `Módulos`, `Archivo origen`, `Última sincronización`):
    - con `--dry-run`: imprime el resumen de esas properties + el hash calculado, **sin** llamar a `createCourse`, `upsertCourse` ni `saveRegistry`, y **sin** seguir al push de módulos (no hay `pageId` real para usar de parent).
    - sin `--dry-run`: llama a `createCourse(databaseId, properties)` y, con el `pageId` resultante, a `upsertCourse` + `saveRegistry`.
  - En todo caso donde sí hay un `pageId` real (slug ya registrado, o slug nuevo sin `--dry-run`) delega en `runSync({ docxPath, parentId, moduleNumber, dryRun, force })` — la función ya existente de `sync.ts`, **sin modificarla**, para subir los módulos.
  - Si `!dryRun`, después de que `runSync` termine sin errores: `PATCH` a la fila de Notion actualizando `Módulos` (`manifest.modules.length` de la conversión más reciente) y `Última sincronización` (fecha de hoy) — para curso nuevo y para uno ya existente por igual. Para el caso de slug **ya existente**, además llama a `upsertCourse` + `saveRegistry` (recalcula `docxHash`/`lastSyncedAt` en el registro local, y lanza si `docxFileName` cambió — colisión ya cubierta por `upsertCourse` de SPEC 07).
  - Título por defecto: versión "prettified" del basename del `.docx` (guiones/underscores → espacios, capitalizado) si no se pasa `--titulo`; con `--titulo` se usa tal cual.
  - `--area`/`--plataforma`: strings libres, sin validar contra ninguna lista cerrada — se mandan tal cual al `select` de Notion (que crea la opción si no existe).
  - `--estado`: default `"Terminado"` si no se pasa; también libre, sin lista cerrada validada en código.
  - `NOTION_CURSOS_DATABASE_ID`: nueva env var (mismo mecanismo que `NOTION_TOKEN`, vía `loadEnv`), requerida cuando el slug es nuevo (con o sin `--dry-run`) — error claro si falta.
  - Script `"sync-course": "node src/cli/sync-course.ts"` en `package.json`.
  - `.env.example`: agregar `NOTION_CURSOS_DATABASE_ID=`.
  - Tests en `src/notion-client/__tests__/hash.test.ts`, `src/notion-client/__tests__/course.test.ts` y `src/cli/__tests__/sync-course.test.ts` (mockeando `notion`, `runSync`, `loadRegistry`/`saveRegistry`/`upsertCourse`).
  - `README.md`: fila nueva para `hash.ts`/`course.ts` en la tabla de `src/notion-client/`, `sync-course.ts` en la tabla de `src/cli/`, y sección de uso en "Instalar y correr".

**Out of scope (para specs futuras o descartado explícitamente):**

- Actualizar `Estado` en corridas posteriores a la creación — solo se escribe una vez, al crear la fila. Spec futura (posible script dedicado) si hace falta.
- Validar `--area` contra una lista cerrada en código — descartado, queda libre ("se limita cuando haya un frontend").
- Validar `--plataforma` contra una lista cerrada con fallback a `Otros` — descartado, también queda libre.
- Modificar `sync.ts`, `push.ts`, `registry.ts`, `push-module.ts` o `state.ts` — se reusan tal cual, sin cambios de firma ni de comportamiento.
- Cualquier UI/frontend para elegir Área/Plataforma de una lista.
- Soportar más de una base `Cursos` — se asume una sola, fija en `NOTION_CURSOS_DATABASE_ID`.

---

## Data model

No se introduce ninguna estructura persistida nueva más allá de lo que
`registry.ts` (SPEC 07) ya define (`CourseRegistryEntry`/`NewCourseEntry`,
sin cambios). Lo nuevo son tipos de transporte para la creación/actualización
de la fila en Notion, y la firma del CLI.

```ts
// src/notion-client/types.ts

export interface CourseProperties {
  titulo: string;
  area: string;
  plataforma: string;
  estado: string;
  modulos: number;
  archivoOrigen: string;
  ultimaSincronizacion: string; // ISO, valor de `date.start`
}
```

```ts
// src/notion-client/course.ts

export async function createCourse(
  databaseId: string,
  properties: CourseProperties,
): Promise<string>; // POST /pages con parent: { database_id }, devuelve el pageId

export async function updateCourseAfterSync(
  pageId: string,
  modulos: number,
): Promise<void>; // PATCH: solo Módulos + Última sincronización (now())
```

```ts
// src/notion-client/hash.ts

export function hashFile(path: string): string; // sha256 hex, readFileSync completo
```

```ts
// src/cli/sync-course.ts

export interface RunSyncCourseOptions {
  docxPath: string;
  moduleNumber?: number;
  dryRun: boolean;
  force: boolean;
  area?: string; // requerido si el slug es nuevo (se valida en runSyncCourse)
  plataforma?: string; // ídem
  estado?: string; // default "Terminado" si falta, aplicado en runSyncCourse
  titulo?: string; // si falta, se genera con prettifyTitle(basename)
}

export async function runSyncCourse(
  options: RunSyncCourseOptions,
): Promise<void>;
function parseArgv(argv: string[]): RunSyncCourseOptions | null;
export function prettifyTitle(basename: string): string; // pura, testeable aislada
```

Conventions:

- `createCourse` mapea `CourseProperties` a las properties crudas de Notion
  internamente: `Título` → `title`, `Área`/`Plataforma`/`Estado` → `select`
  (`{ name }`), `Módulos` → `number`, `Archivo origen` → `rich_text`,
  `Última sincronización` → `date`. Nunca toca `Notas`.
- `updateCourseAfterSync` solo actualiza `Módulos` y `Última sincronización`
  — no reconstruye `Título`/`Área`/`Plataforma`/`Estado`, que ya quedaron
  fijas desde la creación.
- `RunSyncCourseOptions` es deliberadamente plano, mismo criterio que
  `RunSyncOptions` de SPEC 05 — no reusa ese tipo ni lo extiende, ya que
  `parentId` ni siquiera es un campo acá (se resuelve internamente).
- `prettifyTitle` vive en `sync-course.ts`, no en `docx-to-md/modules.ts`
  junto a `slugify` — es una transformación de presentación (para el título
  de la fila de Notion), no parte del pipeline de conversión.

---

## Implementation plan

1. **Tipos + `hash.ts`**: agregar `CourseProperties` a `src/notion-client/types.ts`. Crear `src/notion-client/hash.ts` con `hashFile(path)` (sha256 hex, `readFileSync` completo). Tests en `src/notion-client/__tests__/hash.test.ts` (hash conocido sobre un buffer/archivo fijo, dos llamadas al mismo archivo dan el mismo hash, archivos distintos dan hashes distintos). Deja el sistema funcional: módulo nuevo y aislado, no toca nada existente.

2. **`course.ts`**: `createCourse(databaseId, properties)` (`POST /pages`, mapea `CourseProperties` a las properties crudas de Notion descritas en el Data model) y `updateCourseAfterSync(pageId, modulos)` (`PATCH` solo `Módulos` + `Última sincronización`). Tests en `src/notion-client/__tests__/course.test.ts` mockeando `notion()` (`vi.mock` de `./client.ts`): body correcto del `POST` (incluye `parent: { database_id }` y las 7 properties mapeadas, nunca `Notas`); body correcto del `PATCH` (solo `Módulos` + `Última sincronización`, no toca el resto).

3. **`sync-course.ts` completo**: `parseArgv` (posicionales `<docx> [MODULO_N]` + flags `--area`/`--plataforma`/`--estado`/`--titulo`/`--dry-run`/`--force`), `prettifyTitle`, y `runSyncCourse` con toda la lógica: calcular `slug`+`docxHash`, `loadRegistry`, resolver `parentId` (registro existente vs. `--area`/`--plataforma` obligatorios + `createCourse` para slug nuevo), rama `--dry-run` de creación (imprime resumen, no crea nada, no sigue al push). Para **slug nuevo** sin `--dry-run`: `createCourse` → `upsertCourse`+`saveRegistry` (el registro queda consistente con la fila recién creada antes de arriesgar la subida de módulos) → delegar en `runSync` (de `sync.ts`, sin modificarlo) → si no lanzó, `updateCourseAfterSync`. Para **slug ya registrado**: delegar directo en `runSync` → si `!dryRun` y no lanzó, `upsertCourse`+`saveRegistry`+`updateCourseAfterSync` (en ese orden). `main()` conectando `parseArgv(process.argv.slice(2))` con `runSyncCourse`. Tests en `src/cli/__tests__/sync-course.test.ts` mockeando `runSync` (de `../cli/sync.ts`), `createCourse`/`updateCourseAfterSync`, `loadRegistry`/`saveRegistry`/`upsertCourse`, `hashFile`: slug nuevo sin `--area`/`--plataforma` → error de uso antes de tocar red; slug nuevo con `--dry-run` → no llama `createCourse`/`upsertCourse`/`saveRegistry`/`runSync`; slug nuevo sin `--dry-run` → `createCourse` → `upsertCourse`+`saveRegistry` → `runSync` con el `pageId` nuevo → `updateCourseAfterSync`; slug ya registrado → usa `pageId` del registro, no exige `--area`/`--plataforma`, llama `runSync` → (si `!dryRun`) `upsertCourse`+`saveRegistry`+`updateCourseAfterSync`; slug nuevo donde `runSync` lanza → `upsertCourse`+`saveRegistry` ya se llamaron (antes del push) pero `updateCourseAfterSync` no se llama; slug ya registrado donde `runSync` lanza → ninguno de los tres (`upsertCourse`/`saveRegistry`/`updateCourseAfterSync`) se llama.

4. **`package.json`/`.env.example`**: agregar `"sync-course": "node src/cli/sync-course.ts"` a `scripts`; agregar `NOTION_CURSOS_DATABASE_ID=` a `.env.example`.

5. **`README.md`**: fila de `hash.ts` y `course.ts` en la tabla de `src/notion-client/`; fila de `sync-course.ts` en la tabla de `src/cli/`; sección de uso en "Instalar y correr" (`npm run sync-course -- <docx> [MODULO_N] --area <area> --plataforma <plataforma> [--estado <estado>] [--titulo <titulo>] [--dry-run] [--force]`), explicando el camino de creación vs. el de curso ya conocido, y mencionando la precondición manual de que `NOTION_CURSOS_DATABASE_ID` y las properties `Última sincronización`/`Archivo origen` ya existan en la base real.

6. **Verificación real** (no en CI): con Notion y `workspace/` ya limpios de
   antemano (a cargo del usuario), el agente corre `npm run sync-course` de
   punta a punta contra el `NOTION_CURSOS_DATABASE_ID` real, usando el
   `.docx` real de "Curso Profesional de JavaScript":
   - Primera corrida (slug nuevo, `--area Frontend --plataforma Platzi`):
     confirma programáticamente (respuesta de `createCourse` + lectura de
     `course-registry.json`) que la fila se creó con las properties
     correctas y que `runSync` subió los módulos sin error.
   - Segunda corrida (mismo `.docx`, ya registrado, sin `--area`/
     `--plataforma`): confirma que resuelve el `pageId` del registro sin
     pedir los flags, no duplica la fila, y actualiza `Módulos`/`Última
sincronización`.
   - `--dry-run` en ambos escenarios (slug nuevo y ya registrado): confirma
     que no hay llamadas de red (ni `createCourse`, ni `updateCourseAfterSync`,
     ni `runSync` tocando `notion()`).
     El agente hace todo esto por CLI/Bash, sin pasos manuales de parte del
     usuario salvo uno: **confirmar a simple vista en Notion que los módulos
     del curso quedaron subidos correctamente como subpáginas** de la fila
     creada.

---

## Acceptance criteria

- [x] `npm run typecheck` y `npm test` pasan sin errores con los archivos nuevos (`hash.ts`, `course.ts`, `sync-course.ts` y sus tests) y los tipos agregados a `types.ts`.
- [x] `hashFile` devuelve el mismo hash para el mismo contenido de archivo, y hashes distintos para contenidos distintos. (Test.)
- [x] `createCourse` hace `POST /pages` con `parent: { database_id }` y las 7 properties mapeadas correctamente (`Título`, `Área`, `Plataforma`, `Estado`, `Módulos`, `Archivo origen`, `Última sincronización`), sin tocar `Notas`. (Test.)
- [x] `updateCourseAfterSync` hace `PATCH` tocando **solo** `Módulos` y `Última sincronización`. (Test.)
- [x] `runSyncCourse` con slug nuevo y sin `--area`/`--plataforma` lanza un error de uso claro antes de tocar la red (no llama `notion`, `createCourse` ni `runSync`). (Test.)
- [x] `runSyncCourse` con slug nuevo y `--dry-run` no llama a `createCourse`, `upsertCourse`, `saveRegistry` ni `runSync`. (Test.)
- [x] `runSyncCourse` con slug nuevo sin `--dry-run` llama, en orden: `createCourse` → `upsertCourse`+`saveRegistry` → `runSync` (con el `pageId` nuevo como parent) → `updateCourseAfterSync`. (Test.)
- [x] `runSyncCourse` con slug ya registrado resuelve el `pageId` desde el registro sin exigir `--area`/`--plataforma` (aunque falten), llama a `runSync`, y si `!dryRun` llama también a `upsertCourse`+`saveRegistry`+`updateCourseAfterSync` (en ese orden, después de `runSync`). (Test.)
- [x] `runSyncCourse` con slug ya registrado y `--dry-run` no llama a `upsertCourse`, `saveRegistry` ni `updateCourseAfterSync` (solo delega en `runSync` con `dryRun: true`). (Test.)
- [x] Si `runSync` lanza con slug **nuevo**, `runSyncCourse` no llama a `updateCourseAfterSync` — pero `upsertCourse`+`saveRegistry` ya se llamaron antes del push, así que el registro queda consistente con la fila creada. Si `runSync` lanza con slug **ya registrado**, `runSyncCourse` aborta sin llamar a `upsertCourse`/`saveRegistry`/`updateCourseAfterSync` (ninguno de los tres se ejecutó todavía). (Test.)
- [x] `prettifyTitle("curso-profesional-de-javascript")` devuelve `"Curso Profesional De Javascript"` (guiones/underscores → espacios, cada palabra capitalizada); `--titulo` explícito lo pisa tal cual. (Test.)
- [x] `--estado` ausente aplica el default `"Terminado"` en las properties de creación. (Test.)
- [x] Falta `NOTION_CURSOS_DATABASE_ID` con slug nuevo produce un error de configuración claro, antes de llamar a `createCourse`. (Test.)
- [x] `package.json` tiene el script `"sync-course": "node src/cli/sync-course.ts"`.
- [x] `.env.example` incluye `NOTION_CURSOS_DATABASE_ID=`.
- [x] `README.md` documenta `hash.ts`/`course.ts` en la tabla de `src/notion-client/`, `sync-course.ts` en la de `src/cli/`, y el ejemplo de uso en "Instalar y correr" (incluyendo la precondición manual del esquema de `Cursos`).
- [x] Corrida real (agente, vía Bash) de `npm run sync-course -- <docx-de-"Curso Profesional de JavaScript"> --area Frontend --plataforma Platzi` contra el `NOTION_CURSOS_DATABASE_ID` real: crea la fila con las properties correctas y sube los módulos sin error. (Verificado por el agente.)
- [x] Segunda corrida real, mismo `.docx`, sin `--area`/`--plataforma`: resuelve el `pageId` del registro, no duplica la fila, actualiza `Módulos`/`Última sincronización`. (Verificado por el agente.)
- [x] `--dry-run` real en ambos escenarios (slug nuevo y ya registrado) no genera ninguna llamada de red. (Verificado por el agente.)
- [x] Los módulos de "Curso Profesional de JavaScript" quedan visiblemente subidos como subpáginas correctas de la fila creada. (Verificado a mano por el usuario.)

---

## Decisions

- **Sí:** un CLI nuevo, `src/cli/sync-course.ts`, que delega en el `runSync` ya existente de `sync.ts` — en vez de modificar `sync.ts` para hacer `PARENT_PAGE_ID` opcional. Evita el riesgo de regresión en un comando ya verificado contra Notion real y evita la ambigüedad de parseo de tener un posicional opcional junto a `MODULO_N`.
- **Sí:** `sync.ts` queda **intacto**, sin ningún cambio de firma ni comportamiento — sigue siendo la vía manual/override con `PARENT_PAGE_ID` explícito para casos puntuales (debug, corregir algo a mano).
- **Sí:** `sync-course` resuelve el parent automáticamente en todos los casos (registro si el slug ya existe, `createCourse` si es nuevo) — se convierte en el comando de uso diario, sin distinguir "primera vez" de "ya conocido" a nivel de comando.
- **Sí:** `sync-course` no acepta un `parentId` explícito como argumento — siempre se resuelve internamente. Esto vuelve moot la pregunta de "qué pasa si el argumento no coincide con el registro" que se había considerado antes de separar este comando de `sync.ts`.
- **Sí:** `--area`/`--plataforma` obligatorios **solo** cuando el slug es nuevo — evita fricción de tener que repetirlos en cada corrida de un curso ya conocido, donde de todos modos se ignorarían.
- **Sí:** sin validación de lista cerrada en código para `--area` ni `--plataforma` — decisión explícita del usuario, queda abierto ("se limita cuando haya un frontend" para elegir valores).
- **Sí:** `--estado` es opcional con default `"Terminado"`, y se escribe **solo** al crear la fila — nunca se actualiza en corridas posteriores, respetando que `Estado` es curatorial (memoria de diseño del proyecto). Actualizarlo después queda para una spec futura.
- **Sí:** `Módulos` y `Última sincronización` se actualizan en **cada** corrida (creación y subsiguientes vía `updateCourseAfterSync`) — a diferencia de `Estado`, estas dos son bookkeeping puro que el pipeline puede mantener sincronizado sin intervención humana.
- **Sí:** las properties `Última sincronización` (date) y `Archivo origen` (text) ya se agregaron a mano al esquema real de `Cursos` (precondición manual, confirmada durante esta sesión) — el script solo escribe sus valores, no las crea vía API.
- **Sí:** título por defecto = versión "prettified" del basename del `.docx` (guiones/underscores → espacios, cada palabra capitalizada, ej. `curso-profesional-de-javascript` → `Curso Profesional De Javascript`), overridable con `--titulo`.
- **Sí:** `hashFile` usa `sha256` vía `readFileSync` completo (sin streaming) — los `.docx` de curso pesan pocos MB.
- **Sí:** `createCourse`/`updateCourseAfterSync` viven en un módulo nuevo `src/notion-client/course.ts`, separado de `registry.ts` (que por decisión de SPEC 07 quedó acotado a persistencia pura, sin red) y de `sync-course.ts` (que orquesta, no hace llamadas `notion()` crudas inline).
- **Sí:** para un curso nuevo, el orden es crear la fila → `upsertCourse`+`saveRegistry` → recién ahí subir los módulos — si el push falla a mitad de camino, la fila y el registro ya quedan consistentes y una corrida siguiente resume sin re-crear nada.
- **Sí:** `upsertCourse` se llama en **cada** corrida sobre un curso ya registrado (no solo en la creación) — mantiene `docxHash`/`lastSyncedAt` actualizados y detecta colisiones de `docxFileName` (mecanismo ya definido en SPEC 07).
- **Sí:** `NOTION_CURSOS_DATABASE_ID` es una env var nueva (mismo mecanismo que `NOTION_TOKEN`, vía `loadEnv`), requerida solo cuando el slug es nuevo, incluso con `--dry-run` (para detectar un problema de configuración temprano, sin esperar a una corrida real).
- **Sí:** la verificación real (paso 6 del plan) la ejecuta el agente por CLI/Bash contra Notion real, no el usuario — el usuario solo confirma a simple vista que los módulos de "Curso Profesional de JavaScript" quedaron subidos correctamente.

- **No:** permitir actualizar `Estado` en corridas posteriores — descartado, posible spec futura o script dedicado si hace falta.
- **No:** validar `--area`/`--plataforma` contra una lista cerrada en código — descartado explícitamente por el usuario.
- **No:** modificar `sync.ts`, `push.ts`, `registry.ts`, `push-module.ts` o `state.ts` — se reusan tal cual.
- **No:** soportar más de una base `Cursos` — se asume una sola, fija en `NOTION_CURSOS_DATABASE_ID`.
- **No:** cualquier UI/frontend para elegir `Área`/`Plataforma` de una lista — mencionado como posible evolución futura, no en esta spec.
