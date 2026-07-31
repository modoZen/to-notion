# SPEC 09 — Slug de curso incluye la carpeta contenedora

> **Status:** Aprobado
> **Depends on:** SPEC 01 (`slugify` en `src/docx-to-md/modules.ts`), SPEC 07 (`registry.ts`: `CourseRegistryEntry.docxFileName`, `upsertCourse`), SPEC 08 (`sync-course.ts`, que hoy calcula el slug solo con el basename del `.docx`)
> **Date:** 2026-07-31
> **Objective:** Introducir `courseSlug(docxPath)` en `modules.ts`, que combina el nombre de la carpeta contenedora con el basename del `.docx` (reemplazando el cálculo duplicado en `sync.ts`, `sync-course.ts`, `convert.ts` y `docx-to-md/convert.ts`) y enriquecer `docxFileName` del registro con esa misma carpeta+archivo, para que dos cursos distintos cuyo `.docx` comparte nombre de archivo en carpetas distintas dejen de colisionar bajo el mismo slug.

---

## Scope

**In:**

- Nueva función `courseSlug(docxPath: string): string` en `src/docx-to-md/modules.ts`, junto a `slugify()`. Calcula `folder = basename(dirname(resolve(docxPath)))`, `file = basename(docxPath, extname(docxPath))`, y devuelve `slugify(`${folder}-${file}`)`. `slugify()` en sí no cambia — sigue usándose tal cual para slugs de módulo (`docx-to-md/convert.ts:64`).
- Nueva función `courseFolderName(docxPath: string): string` en el mismo archivo — extrae `folder` como función propia, reutilizada por `courseSlug` y por `sync-course.ts`.
- Reemplazar el cálculo duplicado `slugify(basename(docxPath, extname(docxPath)))` por `courseSlug(docxPath)` en los 4 call sites existentes: `src/cli/sync.ts:65`, `src/cli/sync-course.ts:76`, `src/cli/convert.ts:23`, `src/docx-to-md/convert.ts:17`.
- En `sync-course.ts`, el `docxFileName` que se pasa a `upsertCourse` pasa a ser `${courseFolderName(docxPath)}/${basename(docxPath)}` (ej. `"CursoA/Clases.docx"`) en vez de solo `basename(docxPath)`.
- Actualizar el comentario de `CourseRegistryEntry.docxFileName` en `types.ts` para reflejar el nuevo contenido (carpeta+archivo, no solo basename).
- **`prettifyTitle` (SPEC 08):** cuando el basename del `.docx` (sin extensión, sin acentos, case-insensitive) es exactamente `"clase"` o `"clases"`, el título default se genera aplicando `prettifyTitle` sobre `courseFolderName(docxPath)` en vez de sobre el basename del archivo. En cualquier otro caso, comportamiento idéntico al actual (basename del archivo). `--titulo` explícito sigue pisando el default en ambos casos.
- Tests nuevos para `courseSlug`/`courseFolderName` en `src/docx-to-md/__tests__/modules.test.ts`: mismo basename en carpetas distintas produce slugs distintos; mismo `docxPath` produce siempre el mismo slug (determinístico); resultado respeta el límite de 50 caracteres ya existente en `slugify()`.
- Tests nuevos/actualizados para `prettifyTitle` con archivo `"Clases.docx"`/`"clase.docx"` en `src/cli/__tests__/sync-course.test.ts`.
- Actualizar tests existentes que dependían del cálculo viejo de slug (`sync.test.ts`, `sync-course.test.ts`, `convert.test.ts`, `docx-to-md/__tests__/convert.test.ts` — los que correspondan) para reflejar `courseSlug`.
- `README.md`: mencionar `courseSlug`/`courseFolderName` (por qué incorporan la carpeta contenedora) donde ya se documenta `slugify`, y el comportamiento especial de `prettifyTitle` para `clase`/`clases` en la sección de `sync-course.ts`.

**Out of scope (para specs futuras o descartado explícitamente):**

- Migración de entradas ya existentes en `course-registry.json` o carpetas `workspace/<slug>/` ya creadas bajo el esquema viejo — quedan como están, sin recalcular ni migrar automáticamente.
- Resolver el caso "misma carpeta, se sobreescribe" (dos cursos distintos con `.docx` de igual nombre en la **misma** carpeta) — fuera de scope, confirmado por el usuario.
- Cualquier UX adicional al detectar una colisión (mensajes sugiriendo `--slug` manual, flag de override, etc.) — el `Error` ya existente de `upsertCourse` (SPEC 07) se propaga tal cual.
- Cambiar la firma de `upsertCourse` o su lógica de comparación — sigue comparando `docxFileName` string a string, solo cambia qué valor le llega.
- Cualquier cambio a `slugify()` en sí (su firma, su lógica de truncamiento/normalización) — se mantiene intacta, usada tal cual para slugs de módulo.
- Ampliar la lista de nombres genéricos de `prettifyTitle` más allá de `clase`/`clases` — si aparecen otros casos (`notas`, `apuntes`, etc.) se agregan en un ajuste futuro.

---

## Data model

```ts
// src/docx-to-md/modules.ts

/** basename() del directorio contenedor del .docx, resuelto a ruta absoluta primero. */
export function courseFolderName(docxPath: string): string;

/** slugify(`${courseFolderName(docxPath)}-${basename sin extensión}`) */
export function courseSlug(docxPath: string): string;
```

```ts
// src/notion-client/types.ts (comentario actualizado, sin cambio de tipo)

export interface CourseRegistryEntry {
  pageId: string;
  docxFileName: string; // "<carpeta>/<archivo>.docx" (ej. "CursoA/Clases.docx"), no ruta completa
  docxHash: string;
  createdAt: string;
  lastSyncedAt: string;
}
```

```ts
// src/cli/sync-course.ts

// Sin cambio de firma — misma función, lógica interna extendida:
export function prettifyTitle(basename: string): string;
// Nuevo: helper interno (no exportado) que decide la fuente del título.
// GENERIC_BASENAMES = new Set(["clase", "clases"]) — comparación normalizada
// (NFD sin diacríticos, lowercase) contra el basename sin extensión.
```

Conventions:

- `courseFolderName` se extrae como función propia (no inline dentro de `courseSlug`) porque `sync-course.ts` la necesita también para armar el nuevo `docxFileName` del registro — una sola fuente de verdad para "qué cuenta como carpeta", en vez de recalcular `dirname`/`resolve`/`basename` por separado en dos archivos.
- `courseSlug` llama a `courseFolderName` internamente y a `slugify()` ya existente — no reimplementa normalización ni truncamiento, los hereda de `slugify()`.
- `resolve(docxPath)` se usa dentro de `courseFolderName` para que una ruta relativa (`./Clases.docx`, sin carpeta explícita) también produzca una carpeta real (el cwd resuelto), no `"."`.
- La detección de nombre genérico vive en `sync-course.ts` (junto a `prettifyTitle`), no en `modules.ts` — es una decisión de presentación del título, no del pipeline de conversión (mismo criterio que ya estableció SPEC 08 para separar `prettifyTitle` de `slugify`).
- `GENERIC_BASENAMES` es una constante interna de `sync-course.ts`, no una property/export nueva — no hace falta configurarla desde afuera todavía.

---

## Implementation plan

1. **`courseFolderName` + `courseSlug` en `modules.ts`**: agregar ambas funciones junto a `slugify()`. Tests en `src/docx-to-md/__tests__/modules.test.ts`: mismo basename en carpetas distintas produce slugs distintos; mismo `docxPath` es determinístico; respeta el límite de 50 caracteres de `slugify()`; ruta relativa sin carpeta explícita no rompe (resuelve al cwd). Deja el sistema funcional: funciones nuevas y aisladas, nada más las usa todavía.

2. **Wiring de `courseSlug` en los 4 call sites**: reemplazar `slugify(basename(docxPath, extname(docxPath)))` por `courseSlug(docxPath)` en `sync.ts`, `sync-course.ts`, `convert.ts`, `docx-to-md/convert.ts`. Actualizar los tests existentes de esos 4 archivos que dependían del slug viejo (mocks/fixtures con el nuevo valor esperado). `npm run typecheck && npm test` deben pasar limpios.

3. **`docxFileName` enriquecido en `sync-course.ts`**: cambiar el cálculo de `docxFileName` a `${courseFolderName(docxPath)}/${basename(docxPath)}`; actualizar comentario de `CourseRegistryEntry.docxFileName` en `types.ts`. Test en `sync-course.test.ts`: dos rutas con mismo basename en carpetas distintas producen `docxFileName` distinto y por lo tanto no colisionan en `upsertCourse`; mismo `docxPath` en corridas sucesivas sigue actualizando la misma entrada sin lanzar.

4. **`prettifyTitle` con detección de nombre genérico**: agregar `GENERIC_BASENAMES = new Set(["clase", "clases"])` (comparación normalizada NFD sin diacríticos, lowercase) y la lógica que, cuando el basename del `.docx` matchea, genera el título default desde `courseFolderName(docxPath)` en vez del basename. Tests en `sync-course.test.ts`: `"Clases.docx"` en carpeta `"Curso-Profesional-de-JavaScript"` → título `"Curso Profesional De Javascript"`; basename no genérico (ej. `"Curso-X.docx"`) → comportamiento idéntico al actual; `--titulo` explícito sigue pisando en ambos casos.

5. **`README.md`**: documentar `courseSlug`/`courseFolderName` (por qué incorporan la carpeta contenedora) donde ya se documenta `slugify`, y el comportamiento especial de `prettifyTitle` para `clase`/`clases` en la sección de `sync-course.ts`.

6. **Verificación real** (no en CI, por el agente vía Bash, solo con `--dry-run`): usando los 2 `.docx` reales del usuario ("Curso Profesional de JavaScript" y el curso de TypeScript), correr `sync-course --dry-run` sobre ambos y confirmar programáticamente que `courseSlug` calcula un valor distinto al que hubiera dado el esquema viejo (slug incluye ahora el nombre de la carpeta contenedora de cada `.docx`), y que el `docxFileName` que se mostraría en el resumen de dry-run tiene el formato `carpeta/archivo`. También correr el escenario sintético de dos `.docx` de prueba con el mismo basename en carpetas temporales distintas (`Clases.docx`) y confirmar que sus `courseSlug`/`docxFileName` difieren entre sí. Todo con `--dry-run` — sin llamadas de red, sin crear ni modificar nada en Notion ni en `course-registry.json`.

---

## Acceptance criteria

- [ ] `npm run typecheck` y `npm test` pasan sin errores con las funciones nuevas (`courseFolderName`, `courseSlug`) y los call sites actualizados.
- [ ] `courseSlug` produce slugs distintos para dos `.docx` con el mismo basename en carpetas distintas. (Test.)
- [ ] `courseSlug` es determinístico: mismo `docxPath` produce siempre el mismo slug. (Test.)
- [ ] `courseSlug` respeta el límite de 50 caracteres ya existente en `slugify()`. (Test.)
- [ ] `courseFolderName` sobre una ruta relativa sin carpeta explícita (ej. `"Clases.docx"`) no lanza y resuelve contra el cwd. (Test.)
- [ ] Los 4 call sites (`sync.ts`, `sync-course.ts`, `convert.ts`, `docx-to-md/convert.ts`) usan `courseSlug(docxPath)` en vez del cálculo duplicado viejo — ninguno llama a `slugify(basename(...))` directamente para el slug de curso.
- [ ] `sync-course.ts` guarda `docxFileName` como `"<carpeta>/<archivo>.docx"` en el registro, no solo el basename. (Test.)
- [ ] Dos `.docx` con el mismo basename en carpetas distintas producen `docxFileName` distinto y por lo tanto **no** colisionan al llamar `upsertCourse` con slugs distintos (cada uno registra su propia entrada). (Test.)
- [ ] `upsertCourse` sigue lanzando su `Error` de colisión existente (SPEC 07) cuando el mismo slug efectivamente corresponde a `docxFileName` distinto (comportamiento sin cambios, solo con datos más precisos de entrada).
- [ ] `prettifyTitle` con basename `"clase"`/`"clases"` (case-insensitive, sin acentos) genera el título default desde `courseFolderName(docxPath)`. (Test.)
- [ ] `prettifyTitle` con basename no genérico mantiene el comportamiento actual (título desde el basename del archivo). (Test.)
- [ ] `--titulo` explícito sigue pisando el default en ambos casos (genérico y no genérico).
- [ ] `README.md` documenta `courseSlug`/`courseFolderName` y el comportamiento especial de `prettifyTitle` para `clase`/`clases`.
- [ ] Verificación real (agente, vía Bash, solo `--dry-run`): con los 2 `.docx` reales del usuario, `courseSlug` calcula un valor distinto al del esquema viejo y el resumen de dry-run muestra `docxFileName` en formato `carpeta/archivo` — sin llamadas de red. (Verificado por el agente.)
- [ ] Verificación real (agente, vía Bash): dos `.docx` de prueba llamados `Clases.docx` en dos carpetas temporales distintas, corridos con `sync-course --dry-run`, producen `courseSlug` y `docxFileName` distintos entre sí. (Verificado por el agente.)

---

## Decisions

- **Sí:** el slug de curso pasa a depender de `courseFolderName(docxPath)` (basename de la carpeta contenedora) + basename del archivo, no solo del archivo — la colisión real reportada ocurre cuando distintos cursos usan `.docx` con el mismo nombre en carpetas distintas.
- **Sí:** `courseSlug`/`courseFolderName` viven en `src/docx-to-md/modules.ts`, junto a `slugify()` — mismo archivo, mismo criterio de "utilidades puras de nombres" ya establecido.
- **No:** modificar `slugify()` en sí — sigue usándose tal cual para slugs de módulo (`docx-to-md/convert.ts:64`); cambiar su firma o comportamiento rompería ese uso no relacionado.
- **Sí:** `courseFolderName` se extrae como función propia (no inline) porque `sync-course.ts` la reutiliza para `docxFileName` — una sola fuente de verdad para "qué cuenta como carpeta", en vez de recalcular `resolve`/`dirname`/`basename` en dos lugares.
- **Sí:** `docxFileName` en el registro pasa de basename puro a `"<carpeta>/<archivo>.docx"` — mantiene la detección de colisión de `upsertCourse` alineada con lo que ahora compone el slug, sin cambiar la firma ni la lógica de `upsertCourse` (SPEC 07 queda intacta).
- **No:** migrar entradas ya existentes en `course-registry.json` ni carpetas `workspace/<slug>/` del esquema viejo — se decidió explícitamente no migrar en código. Solo hay 2 cursos registrados hoy (JavaScript, TypeScript); resincronizarlos "de verdad" (sin `--dry-run`) bajo el esquema nuevo es una decisión operativa del usuario a tomar cuando quiera (implica borrar `workspace/` local y decidir qué hacer con las filas ya existentes en Notion), fuera del alcance de esta spec.
- **No:** resolver el caso "misma carpeta, se sobreescribe" (dos cursos distintos con `.docx` de igual nombre en la misma carpeta) — confirmado como fuera de scope; el usuario identificó "carpetas distintas" como el escenario real.
- **No:** agregar UX de resolución de colisión (mensajes con sugerencia, flag `--slug` manual) — el `Error` existente de `upsertCourse` alcanza; no se agrega superficie nueva de CLI en esta spec.
- **Sí:** `prettifyTitle` incorpora el nombre de la carpeta **solo** cuando el basename del `.docx` matchea una lista cerrada de nombres genéricos (`"clase"`, `"clases"`) — se prefirió la heurística acotada sobre "siempre combinar carpeta+archivo" para no generar títulos redundantes cuando el archivo ya es descriptivo.
- **No:** ampliar la lista de genéricos más allá de `clase`/`clases` en esta spec — se deja para un ajuste futuro si aparecen más casos (`notas`, `apuntes`, etc.).
- **Sí:** cuando el basename matchea la lista genérica, el título resultante es **solo** la carpeta prettificada (no `"carpeta - archivo"`) — el archivo genérico no aporta información al título.
- **Sí:** la detección de nombre genérico vive en `sync-course.ts`, no en `modules.ts` — es una decisión de presentación del título (SPEC 08), no del pipeline de conversión (mismo criterio que ya separó `prettifyTitle` de `slugify`).
- **Sí:** la verificación real de esta spec se hace enteramente con `--dry-run`, sin tocar Notion real — el bug es puramente de cálculo local (slug/identidad), verificable sin red, y evita cualquier riesgo de fila duplicada mientras el usuario no haya decidido cómo resincronizar sus 2 cursos ya registrados.
