# SPEC 03 — Cliente de Notion y subida de un módulo (notion-client)

> **Status:** Aprobado
> **Depends on:** SPEC 01 (markdown + imágenes en `workspace/<slug>/`), SPEC 02 (`mdToBlocks` en modo `'marker'`, `batch`)
> **Date:** 2026-07-29
> **Objective:** Portar fielmente la Parte 3 del prototipo (`references/notion-sync.js`, líneas 1270-1475) a un módulo TypeScript probado con Vitest (`src/notion-client/`), junto con un CLI angosto (`npm run push`) para subir un módulo suelto a Notion a mano.

---

## Scope

**In:**

- Módulo `src/notion-client/`, puerto fiel de la Parte 3 de `references/notion-sync.js` (líneas 1270-1475):
  - `notion(method, endpoint, body)`: wrapper de fetch nativo con rate-limit (~3 req/s, `MIN_INTERVAL_MS = 340`) y reintentos (`MAX_RETRIES = 5`), respeta `Retry-After` en 429, backoff exponencial en 5xx. Token leído de `NOTION_TOKEN`.
  - `loadEnv()`: lee un `.env` simple del directorio actual, sin pisar variables ya seteadas en `process.env`.
  - `uploadImage(filePath)`: sube un archivo (reservar → enviar contenido → devolver `file_upload` id), valida el límite de 20 MiB (`MAX_UPLOAD`), mapea extensión a MIME (`MIME`).
  - `resolveImages(blocks, idByToken)`: sustituye los bloques `_marker` (modo `'marker'` de SPEC 02) por bloques `image` reales; si falta el id, deja el bloque de texto original como fallback.
  - `loadState(outDir)` / `saveState(outDir, state)`: persisten `.notion-sync-state.json` en `outDir` — qué módulo (`parentId` + número) ya quedó `done` y bajo qué `pageId`.
  - `pushModule(mod, mdPath, mediaDir, parentId, outDir, state, dryRun)`: orquesta un módulo puntual — si ya está `done` lo salta; si hay un intento previo incompleto (`pageId` sin `done`), archiva esa página antes de rehacer; sube imágenes, resuelve markers, crea la página con el primer lote de bloques y hace `PATCH` del resto; guarda estado después de crear la página y de nuevo al terminar. `dryRun` es del módulo en sí (calcula bloques/imágenes, no toca la red).
- Constantes idénticas al prototipo, sin hacerlas configurables: `NOTION_VERSION = '2026-03-11'`, `MIN_INTERVAL_MS = 340`, `MAX_RETRIES = 5`, `MAX_UPLOAD = 20 * 1024 * 1024`.
- Sin `@notionhq/client` ni otro SDK oficial: fetch nativo de Node + los tipos propios de `src/md-to-notion/types.ts` (SPEC 02).
- CLI `npm run push -- --modulo <ruta.md> --media <mediaDir> --parent <PARENT_PAGE_ID> [--dry-run]`:
  - `outDir` (para `.notion-sync-state.json`) se deriva como la carpeta padre de `--media`, sin flag propio.
  - `mod.number` y `mod.title` se obtienen preferentemente de `manifest.json` en `outDir` (si existe, buscando la entrada cuyo número coincide con el prefijo `NN-` del nombre de archivo de `--modulo`); si no hay `manifest.json`, se reconstruyen del nombre de archivo (`NN-titulo-slug.md`).
  - `--dry-run` del CLI se mapea 1:1 al parámetro `dryRun` de `pushModule`.
- Tests de Vitest con `fetch` global mockeado (sin red real) y `vi.useFakeTimers()` para los casos de rate-limit/retry/backoff, sin depender de esperas reales.

**Out of scope (para specs futuras):**

- CLI end-to-end `.docx` → Notion con `[MODULO_N]` y recorrido de todos los módulos de un curso (SPEC 04, `sync.orchestration`).
- Chequeo de acceso a la página padre (`GET /pages/:id` con mensajes de ayuda si el token o el id están mal) — se agrega en el CLI completo de SPEC 04.
- El flag `--dry-run` del CLI completo de SPEC 04 (que decide si convertir el `.docx` o no); en esta spec `--dry-run` solo controla `pushModule` para un módulo ya convertido.
- Registro de cursos / `course-registry.json` (SPEC 05).
- Creación de filas de curso en la base `Cursos` (SPEC 06, fase 2).
- Tests contra la API real de Notion en CI — la validación real es manual, con `NOTION_TOKEN` y una página padre real.

---

## Data model

```ts
// src/notion-client/types.ts

export type HttpMethod = "GET" | "POST" | "PATCH";

export interface NotionRequestExtra {
  headers?: Record<string, string>;
}

export interface ModuleState {
  pageId: string;
  done: boolean;
}

export interface ParentState {
  modules: Record<string, ModuleState>; // clave: String(mod.number)
}

// Persistido en <outDir>/.notion-sync-state.json
export type SyncState = Record<string, ParentState>; // clave: parentId

// Entrada mínima que pushModule necesita del módulo a subir.
export interface PushModuleInput {
  number: number;
  title: string;
}
```

Firmas principales (sin archivo de tipos propio, van junto a su implementación):

```ts
// src/notion-client/client.ts
function loadEnv(): void;
async function notion<T = unknown>(
  method: HttpMethod,
  endpoint: string,
  body?: unknown,
  extra?: NotionRequestExtra,
): Promise<T>;

// src/notion-client/images.ts
async function uploadImage(filePath: string): Promise<string>; // file_upload id
function resolveImages(
  blocks: NotionBlock[], // de src/md-to-notion/types.ts (SPEC 02)
  idByToken: Record<string, string>,
): NotionBlock[];

// src/notion-client/state.ts
function loadState(outDir: string): SyncState;
function saveState(outDir: string, state: SyncState): void;

// src/notion-client/push-module.ts
async function pushModule(
  mod: PushModuleInput,
  mdPath: string,
  mediaDir: string,
  parentId: string,
  outDir: string,
  state: SyncState,
  dryRun: boolean,
): Promise<void>;
```

Conventions:

- `PushModuleInput` es deliberadamente mínimo (`number` + `title`), no el `ConvertedModule` completo de SPEC 01 — `pushModule` no necesita `file`/`images`/`stats`, y así queda desacoplado del `Manifest` de SPEC 01.
- La resolución de `PushModuleInput` a partir de `manifest.json` o del nombre de archivo (decidida en la sección Scope) vive en `src/cli/push.ts`, no en `src/notion-client/` — el módulo recibe el dato ya resuelto, igual que `mdToBlocks` en SPEC 02 no sabe de dónde vino el `.md`.
- `notion()` lanza `Error` con el mismo formato de mensaje que el prototipo (`${method} ${endpoint} -> ${status}: ${texto recortado a 400 chars}`) cuando se agotan los reintentos o la respuesta no es 2xx.
- `MIME` es el mismo mapa cerrado del prototipo (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.tiff`, `.emf`); una extensión no listada cae a `application/octet-stream`, igual que el prototipo.
- La clave de módulo dentro de `ParentState.modules` es `String(mod.number)`, igual que el prototipo (`state[parentId].modules[key]`).

---

## Implementation plan

1. `src/notion-client/client.ts`: `loadEnv()` y `notion()` con rate-limit y reintentos. Tests con `fetch` global mockeado y `vi.useFakeTimers()`: token faltante lanza error claro, espera de `retry-after` en 429, backoff exponencial en 5xx hasta `MAX_RETRIES`, error final tras agotar reintentos, `.env` no pisa una variable ya presente en `process.env`.
2. `src/notion-client/images.ts`: `MIME`, `MAX_UPLOAD`, `uploadImage()` (usa `notion()` del paso 1) y `resolveImages()`. Tests: archivo que supera 20 MiB lanza error, extensión mapeada vs. extensión desconocida (`application/octet-stream`), bloque `_marker` con id disponible se convierte a bloque `image`, bloque `_marker` sin id cae al bloque de texto original.
3. `src/notion-client/state.ts`: `statePath`, `loadState`, `saveState`. Tests con directorio temporal: archivo inexistente devuelve `{}`, round-trip de escritura y lectura conserva la forma de `SyncState`.
4. `src/notion-client/push-module.ts`: `pushModule()` completo (usa `mdToBlocks`/`batch` de SPEC 02 y `notion`/`uploadImage`/`resolveImages`/`loadState`/`saveState` de los pasos previos). Tests con `notion`/`uploadImage` mockeados: módulo ya `done` se salta sin tocar la red, intento previo incompleto (`pageId` sin `done`) archiva esa página antes de rehacer, `dryRun: true` no llama a la red y no escribe estado, imagen faltante en disco deja el marcador y continúa, más de 100 bloques dispara varios `PATCH` en orden, el estado se guarda después de crear la página y de nuevo al terminar.
5. `src/cli/push.ts` + script `"push"` en `package.json`: parseo manual de `--modulo`, `--media`, `--parent`, `--dry-run` (sin dependencia nueva de parsing de flags, mismo criterio de cero dependencias que SPEC 01/02); deriva `outDir` como la carpeta padre de `--media`; resuelve `PushModuleInput` desde `manifest.json` en `outDir` si existe (matcheando por el número extraído del prefijo `NN-` del nombre de archivo de `--modulo`) o, si no, desde el propio nombre de archivo; llama a `loadEnv()` y `pushModule()`. Test manual: correr `npm run push -- --modulo <ruta.md> --media <mediaDir> --parent <PARENT_PAGE_ID> --dry-run` sobre un módulo real de SPEC 01 y ver el resumen de bloques/imágenes sin tocar la red; luego, con `NOTION_TOKEN` real y una página padre real, correr sin `--dry-run` y verificar la página creada en Notion.
6. `README.md`: agregar la tabla de `src/notion-client/` y la fila `push.ts` en la tabla de `src/cli/`, mismo formato que las secciones existentes.

---

## Acceptance criteria

- [x] `npm run typecheck` y `npm test` pasan sin errores con los archivos nuevos de `src/notion-client/` y `src/cli/push.ts`.
- [x] Cada función de la sección Data model tiene al menos un test: `notion`, `loadEnv`, `uploadImage`, `resolveImages`, `loadState`, `saveState`, `pushModule`.
- [x] `notion()` respeta el header `Retry-After` en una respuesta 429 antes de reintentar (verificado con `fetch` mockeado y `vi.useFakeTimers()`, sin esperar tiempo real).
- [x] `notion()` reintenta una respuesta 5xx con backoff exponencial hasta `MAX_RETRIES` y luego lanza error.
- [x] `notion()` lanza un error claro si `NOTION_TOKEN` no está seteado.
- [x] `uploadImage()` rechaza un archivo que supera 20 MiB con un error que menciona el tamaño.
- [x] `resolveImages()` reemplaza un bloque `_marker` por un bloque `image` real cuando hay id disponible, y deja el bloque de texto original cuando falta el id.
- [x] `loadState()` devuelve `{}` si el archivo de estado no existe; un ciclo `saveState()` + `loadState()` conserva la forma de `SyncState`.
- [x] `pushModule()` salta un módulo ya `done` sin hacer ninguna llamada de red.
- [x] `pushModule()` archiva la página de un intento previo incompleto (`pageId` sin `done`) antes de rehacer la subida.
- [x] `pushModule()` con `dryRun: true` calcula bloques e imágenes pero no hace ninguna llamada de red ni escribe estado.
- [x] `pushModule()` con más de 100 bloques dispara varios `PATCH /blocks/:id/children` en el orden correcto.
- [x] `pushModule()` guarda el estado después de crear la página y de nuevo al terminar (dos escrituras verificables en el test).
- [x] `npm run push -- --modulo <ruta.md> --media <mediaDir> --parent <PARENT_PAGE_ID> --dry-run` corre sobre un módulo real generado por SPEC 01, imprime el resumen de bloques/imágenes y no hace ninguna llamada de red. (Verificado a mano.)
- [x] `npm run push -- --modulo <ruta.md> --media <mediaDir> --parent <PARENT_PAGE_ID>` (sin `--dry-run`), con `NOTION_TOKEN` real y una página padre real, crea la página en Notion con el contenido esperado. (Verificado a mano, no en CI.)
- [x] `README.md` documenta el árbol de archivos de `src/notion-client/` y la fila `push.ts` en la tabla de `src/cli/`.

---

## Decisions

- **Sí:** port fiel de la Parte 3 del prototipo (`notion`, `loadEnv`, `uploadImage`, `resolveImages`, `loadState`/`saveState`, `pushModule`), mismos nombres y misma lógica, sin refactor de comportamiento.
- **No:** agregar `@notionhq/client` u otro SDK oficial. Fetch nativo de Node + tipos propios (de SPEC 02), consistente con la decisión ya tomada en esa spec.
- **Sí:** constantes idénticas al prototipo y hardcodeadas (`NOTION_VERSION`, `MIN_INTERVAL_MS`, `MAX_RETRIES`, `MAX_UPLOAD`). Configurabilidad se pospone hasta que exista un caso real, mismo criterio que `workspace/` en SPEC 01.
- **Sí:** `src/notion-client/` dividido en varios archivos por responsabilidad (`client.ts`, `images.ts`, `state.ts`, `push-module.ts`), igual de granular que `src/docx-to-md/` y `src/md-to-notion/`.
- **Sí:** `outDir` para `pushModule` se deriva como la carpeta padre de `--media` en el CLI, sin flag `--out` explícito. Coincide con el layout real (`workspace/<slug>/{modules,media,manifest.json}`) y evita un tercer path redundante en cada corrida manual.
- **Sí:** `PushModuleInput` mínimo (`number` + `title`) en vez de reusar `ConvertedModule` completo de SPEC 01. Desacopla `pushModule` del `Manifest`; la resolución concreta (leer `manifest.json` o parsear el nombre de archivo) es responsabilidad del CLI, no del módulo.
- **Sí:** el CLI prefiere leer el título desde `manifest.json` cuando existe junto a `--media`, y solo cae a reconstruirlo del nombre de archivo si no lo encuentra. `slugify` (SPEC 01) es lossy (pierde acentos/mayúsculas, trunca a 50 caracteres); usar el manifest evita subir títulos degradados a Notion cuando el `.md` viene del flujo normal.
- **No:** chequeo de acceso a la página padre (`GET /pages/:id` con mensajes de ayuda) en el CLI de esta spec. Es UX del CLI end-to-end, se agrega en SPEC 04.
- **No:** flag `--dry-run` que decida si convertir el `.docx` (eso no existe todavía en esta spec, no hay orquestación docx→push). El `--dry-run` de este CLI solo controla el parámetro `dryRun` de `pushModule` sobre un módulo ya convertido.
- **Sí:** parseo manual de flags (`--modulo`, `--media`, `--parent`, `--dry-run`) en `src/cli/push.ts`, sin dependencia nueva de parsing de argumentos. Mismo criterio de cero dependencias que los CLIs de SPEC 01/02.
- **Sí:** tests con `fetch` global mockeado y `vi.useFakeTimers()` para rate-limit/retry/backoff. Evita tests lentos (los reintentos reales tardarían segundos) sin agregar una superficie de configuración de tiempos que el prototipo no tiene.
- **No:** tests contra la API real de Notion en CI. La validación real es manual, documentada como paso final en el Implementation plan y en Acceptance criteria.

---

## Risks

| Risk                                                                                                                                                                                                                      | Mitigation                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOTION_VERSION` queda fijo en `'2026-03-11'`; si Notion deprecara esa versión de API, las requests empezarían a fallar sin que el código lo detecte de antemano.                                                         | Documentar en `README.md` que la versión de API está pinneada y debe actualizarse a mano si Notion la deprecha; no hay chequeo automático en esta spec.          |
| `fetch`/`FormData` mockeados en los tests no capturan diferencias reales de comportamiento (encoding multipart real, forma exacta de errores de la API de Notion).                                                        | La validación manual contra Notion real (Acceptance criteria) es la red de seguridad final antes de marcar la spec como `Implementado`, igual que en SPEC 01/02. |
| `.notion-sync-state.json` no tiene campo de versión; un cambio futuro a la forma de `SyncState` podría romper la lectura de archivos de estado generados por esta spec.                                                   | Aceptado como gap conocido, mismo criterio que la falta de invalidación por hash en el caché de SPEC 01: se resuelve cuando exista un caso real que lo necesite. |
| Si alguien renombra a mano un `.md` de módulo, el número parseado del nombre de archivo puede no coincidir con ninguna entrada de `manifest.json`, y el CLI cae al título degradado del slug sin avisar de forma ruidosa. | El fallback ya es un comportamiento documentado (Decisions), no un fallo silencioso oculto; se anota en el `README.md` como comportamiento esperado del CLI.     |

---

## What is **not** in this spec

- CLI end-to-end `.docx` → Notion con `[MODULO_N]` y recorrido de todos los módulos de un curso (otra spec, SPEC 04).
- Chequeo de acceso a la página padre (`GET /pages/:id` con mensajes de ayuda) — otra spec, SPEC 04.
- El `--dry-run` del CLI completo que decide si convertir el `.docx` — otra spec, SPEC 04.
- Registro de cursos / `course-registry.json` (otra spec, SPEC 05).
- Creación de filas de curso en la base `Cursos` (fase 2, SPEC 06).
- `@notionhq/client` u otro SDK oficial de Notion.
- Tests contra la API real de Notion en CI.

Cada uno de estos, si se implementa, va en su propia spec.
