# SPEC 07 — Registro cross-course (course-registry)

> **Status:** Implementado
> **Depends on:** SPEC 01 (`slugify` en `src/docx-to-md/modules.ts`), SPEC 03 (convención de persistencia de estado — mutación en el lugar + `load*`/`save*` — ya usada en `src/notion-client/state.ts`)
> **Date:** 2026-07-30
> **Objective:** Agregar un módulo de registro cross-course (`workspace/course-registry.json`), separado del estado por-módulo existente (`.notion-sync-state.json`), que guarde por curso — bajo la misma clave `slug` que ya usa `workspace/<slug>/` — el `pageId` de su fila en `Cursos`, nombre y hash del `.docx` origen, y fechas de alta/última sincronización; sin wiring a `sync.ts`/`push.ts` todavía, como preámbulo para `course.create` (fase 2).

---

## Scope

**In:**

- Nuevo módulo `src/notion-client/registry.ts`, siguiendo el mismo patrón que `state.ts` (`registryPath`, `loadRegistry`, `saveRegistry`) más una función de escritura `upsertCourse`.
- Nuevos tipos en `src/notion-client/types.ts`: `CourseRegistryEntry`, `CourseRegistry` (y el tipo de entrada para `upsertCourse`).
- Persistencia en `<workspaceRoot>/course-registry.json` (default `workspaceRoot = "workspace"`, mismo default que `convertDocx`) — **no** dentro de `workspace/<slug>/`, es cross-course.
- Clave del registro = el mismo `slug` que ya produce `slugify()` (`src/docx-to-md/modules.ts`) sobre el nombre del `.docx` — no se inventa un slug nuevo ni se recalcula distinto.
- `upsertCourse(registry, slug, entry)` muta `registry` en el lugar (mismo criterio que `pushModule` mutando `SyncState`):
  - Slug nuevo: crea la entrada, fija `createdAt` y `lastSyncedAt` al mismo timestamp (`new Date().toISOString()`).
  - Slug existente **con el mismo** `docxFileName`: actualiza `pageId`, `docxHash` y `lastSyncedAt`; conserva `createdAt` original.
  - Slug existente **con `docxFileName` distinto** (colisión por truncamiento a 50 caracteres): lanza un `Error` con mensaje claro, **no** muta `registry` en absoluto.
- `docxHash` llega a `upsertCourse` ya calculado (string) — este módulo no lee el `.docx` ni calcula hashes; eso queda para la spec que wiree esto a `sync.ts`.
- Tests en `src/notion-client/__tests__/registry.test.ts`: `loadRegistry` devuelve `{}` si no existe el archivo; round-trip `saveRegistry`/`loadRegistry`; `upsertCourse` con slug nuevo fija `createdAt === lastSyncedAt`; `upsertCourse` con mismo slug y mismo `docxFileName` actualiza `lastSyncedAt`/`docxHash`/`pageId` y conserva `createdAt`; `upsertCourse` con mismo slug y `docxFileName` distinto lanza y no muta `registry`.
- `README.md`: agregar una fila para `registry.ts` en la tabla de `src/notion-client/` (mismo formato que la fila existente de `state.ts`), sin agregar sección de uso en "Instalar y correr" (no hay CLI ni script nuevo).

**Out of scope (para specs futuras):**

- Wiring a `sync.ts`/`push.ts` para que una corrida real llame a `upsertCourse` automáticamente — spec futura o parte de `course.create`.
- Cálculo del hash del `.docx` (`hashFile()` o similar) — descartado explícitamente para esta spec.
- `course.create` (fase 2): creación de la fila en `Cursos`, `--dry-run` de creación, todo lo que decida qué `pageId` usar la primera vez.
- Cualquier CLI nuevo (`npm run registry` o similar) para inspeccionar/editar el registro a mano.
- Verificación manual contra Notion real — este módulo no toca la red, solo el filesystem; la cobertura de tests unitarios alcanza como criterio de aceptación.

---

## Data model

```ts
// src/notion-client/types.ts

export interface CourseRegistryEntry {
  pageId: string;
  docxFileName: string; // basename tal cual (ej. "curso-x.docx"), no ruta completa
  docxHash: string; // sha256 hex del contenido del .docx, calculado por el caller
  createdAt: string; // ISO, se fija una sola vez al registrar el slug por primera vez
  lastSyncedAt: string; // ISO, se actualiza en cada upsertCourse
}

// Clave: slug (mismo que slugify() en docx-to-md/modules.ts, y el mismo
// que usa workspace/<slug>/). Persistido en <workspaceRoot>/course-registry.json.
export type CourseRegistry = Record<string, CourseRegistryEntry>;

// Campos que el caller de upsertCourse debe proveer explícitamente;
// createdAt/lastSyncedAt los calcula upsertCourse internamente.
export interface NewCourseEntry {
  pageId: string;
  docxFileName: string;
  docxHash: string;
}
```

```ts
// src/notion-client/registry.ts

export function registryPath(workspaceRoot?: string): string; // default "workspace"
export function loadRegistry(workspaceRoot?: string): CourseRegistry; // {} si no existe el archivo
export function saveRegistry(
  workspaceRoot: string,
  registry: CourseRegistry,
): void;

/**
 * Muta `registry` en el lugar. Si `slug` ya existe con un `docxFileName`
 * distinto al de `entry` (colisión de slug por truncamiento a 50 caracteres),
 * lanza un Error y no muta `registry`.
 */
export function upsertCourse(
  registry: CourseRegistry,
  slug: string,
  entry: NewCourseEntry,
): void;
```

Conventions:

- Mismo patrón `<algo>Path` / `load<Algo>` / `save<Algo>` que ya existe en `state.ts` (`statePath`/`loadState`/`saveState`), aplicado a `registry.ts`.
- `CourseRegistry` no repite el `slug` dentro de `CourseRegistryEntry` — es redundante con la clave, mismo criterio que `SyncState` no repite `parentId` dentro de `ParentState`.
- `upsertCourse` no recibe ni devuelve un timestamp explícito — usa `new Date().toISOString()` internamente para `createdAt`/`lastSyncedAt`, igual que `convertDocx` hace con `manifest.generated`.
- Mensaje de error de colisión (no forma parte de un tipo, pero se fija acá para que el test lo pueda verificar): incluye el `slug`, el `docxFileName` ya registrado y el `docxFileName` nuevo — ej. `Colisión de slug "${slug}": ya registrado para "${existing.docxFileName}", no para "${entry.docxFileName}"`.

---

## Implementation plan

1. **Tipos**: agregar `CourseRegistryEntry`, `CourseRegistry` y `NewCourseEntry` a `src/notion-client/types.ts`, junto a los tipos existentes (`SyncState`, `ParentState`, etc.). Deja el sistema funcional: son tipos nuevos, no tocan nada existente.

2. **Persistencia básica**: crear `src/notion-client/registry.ts` con `registryPath(workspaceRoot = "workspace")`, `loadRegistry(workspaceRoot)` (devuelve `{}` si el archivo no existe) y `saveRegistry(workspaceRoot, registry)` — mismo patrón que `statePath`/`loadState`/`saveState` en `state.ts`. Tests en `src/notion-client/__tests__/registry.test.ts` (mismo criterio que `state.test.ts`: `mkdtempSync`/`rmSync` en `beforeEach`/`afterEach`): `loadRegistry` devuelve `{}` sin archivo; round-trip `saveRegistry` + `loadRegistry` conserva la forma de `CourseRegistry`.

3. **`upsertCourse`**: agregar la función a `registry.ts`, mutando `registry` en el lugar. Slug nuevo → crea la entrada con `createdAt === lastSyncedAt` (`new Date().toISOString()`). Slug existente con mismo `docxFileName` → actualiza `pageId`/`docxHash`/`lastSyncedAt`, conserva `createdAt`. Slug existente con `docxFileName` distinto → lanza `Error` con el mensaje descrito en el Data model, sin mutar `registry`. Tests para los tres casos, incluyendo que en el caso de colisión `registry` queda exactamente igual que antes de la llamada (misma referencia de objeto, sin cambios).

4. **`README.md`**: agregar la fila de `registry.ts` a la tabla de `src/notion-client/` (mismo formato que la fila existente de `state.ts`), describiendo brevemente qué persiste y que todavía no está conectado a `sync.ts`/`push.ts`.

---

## Acceptance criteria

- [x] `npm run typecheck` y `npm test` pasan sin errores con los archivos nuevos (`src/notion-client/registry.ts`, `src/notion-client/__tests__/registry.test.ts`) y los tipos agregados a `src/notion-client/types.ts`.
- [x] `loadRegistry(workspaceRoot)` devuelve `{}` si `<workspaceRoot>/course-registry.json` no existe. (Test.)
- [x] Un round-trip `saveRegistry` + `loadRegistry` conserva exactamente la forma de `CourseRegistry` guardada. (Test.)
- [x] `upsertCourse` con un slug nuevo crea la entrada con `createdAt === lastSyncedAt` (mismo timestamp). (Test.)
- [x] `upsertCourse` con un slug existente y el mismo `docxFileName` actualiza `pageId`, `docxHash` y `lastSyncedAt`, y conserva el `createdAt` original sin modificarlo. (Test.)
- [x] `upsertCourse` con un slug existente pero `docxFileName` distinto lanza un `Error` con mensaje que menciona el slug y ambos nombres de archivo (viejo y nuevo). (Test.)
- [x] En el caso de colisión, `registry` queda exactamente igual que antes de la llamada — `upsertCourse` no muta nada al lanzar. (Test.)
- [x] `registryPath(workspaceRoot)` usa `"workspace"` como default cuando no se pasa `workspaceRoot`. (Test.)
- [x] `README.md` incluye la fila de `registry.ts` en la tabla de `src/notion-client/`, describiendo qué persiste y aclarando que todavía no está conectado a `sync.ts`/`push.ts`.
- [x] No hay ningún cambio en `sync.ts`, `push.ts`, `package.json` ni en `.notion-sync-state.json` / su lógica existente — el registro es un archivo y módulo completamente nuevos y separados.

---

## Decisions

- **Sí:** el registro vive en `<workspaceRoot>/course-registry.json`, separado de `.notion-sync-state.json` — uno es cross-course (identidad/última sync), el otro es por-módulo dentro de un `outDir` puntual. No se tocan entre sí.
- **Sí:** la clave del registro es el mismo `slug` que ya produce `slugify()` sobre el nombre del `.docx` (`docx-to-md/modules.ts`), reusado tal cual — no se inventa un slug nuevo ni una función de slugify separada para este módulo.
- **Sí:** el módulo vive dentro de `src/notion-client/` (junto a `state.ts`), no como paquete propio `src/course-registry/` — decisión explícita del usuario, prioriza simplicidad sobre la separación que proponía la memoria de diseño original del proyecto.
- **Sí:** `upsertCourse` muta `registry` en el lugar, igual que `pushModule` muta `SyncState` — consistente con el patrón ya establecido en el resto del código, en vez de una función pura que devuelve un registro nuevo.
- **Sí:** el chequeo de colisión de slug se basa en `docxFileName` (nombre de archivo original), no en `docxHash` — el hash puede cambiar legítimamente si el usuario re-exporta el mismo curso editado, y usarlo rompería el caso normal de resincronizar.
- **Sí:** `docxHash` llega ya calculado como parámetro a `upsertCourse` — esta spec no calcula hashes ni lee el `.docx`, para mantener el módulo acotado a persistencia pura.
- **Sí:** `createdAt` se fija una sola vez (al crear la entrada) y nunca se vuelve a tocar; `lastSyncedAt` se actualiza en cada `upsertCourse`, incluso cuando lo demás no cambió.
- **No:** wiring a `sync.ts`/`push.ts` para llamar a `upsertCourse` automáticamente — queda para una spec futura (posiblemente junto con `course.create`), una vez que se sepa el punto exacto de la corrida donde conviene calcular el hash y llamar al registro.
- **No:** `hashFile()` u otra utilidad de hashing — descartado explícitamente, ver arriba.
- **No:** CLI nuevo (`npm run registry` o similar) para inspeccionar/editar el registro a mano — no hace falta todavía, nadie más lo consume en esta spec.
- **No:** verificación manual contra Notion real como paso del plan — el módulo no toca la red, solo el filesystem; los tests unitarios son criterio de aceptación suficiente (a diferencia de SPEC 03/05/06, que sí requieren un paso manual porque tocan la API real).
