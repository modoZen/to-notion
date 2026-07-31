# to-notion

Convierte documentos Word (apuntes de curso: módulos, prosa, snippets de
código, imágenes) en subpáginas de Notion, colgadas de la fila del curso
correspondiente en una base `Cursos`. El pipeline completo tiene tres etapas:

1. `.docx` → markdown + imágenes extraídas (cacheado en disco, revisable por
   un humano) (`SPEC 01`).
2. markdown → bloques de Notion (`SPEC 02`).
3. cliente de Notion + subida a Notion: un módulo puntual a mano (`SPEC 03`,
   `npm run push`), el `.docx` completo de punta a punta contra un
   `PARENT_PAGE_ID` ya conocido (`SPEC 05`, `npm run sync`), o resolviendo
   ese parent automáticamente — creando la fila del curso en `Cursos` si es
   la primera vez (`SPEC 08`, `npm run sync-course`).

Este repo es público. Los `.docx` de origen y todo lo generado en
`workspace/` (markdown, imágenes, manifest, estado de subida) son contenido
de cursos pagos (Udemy, Platzi, etc.) y nunca se commitean — ver
`.gitignore`.

## Requisitos

- Node.js `>= 24` (se ejecutan los `.ts` directo, sin `ts-node`/`tsx`, usando
  el type-stripping nativo de Node).
- [pandoc](https://pandoc.org/installing.html) en el `PATH`. Validado con
  pandoc `3.1.3`; otras versiones pueden producir markdown crudo ligeramente
  distinto y afectar al tokenizer en casos no cubiertos por los tests.

## Instalar y correr

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run convert -- <ruta/al/archivo.docx>
npm run blocks -- <ruta/al/modulo.md>
npm run push -- --modulo <ruta.md> --media <mediaDir> --parent <PARENT_PAGE_ID> [--dry-run] [--force]
npm run sync -- <ruta/al/archivo.docx> <PARENT_PAGE_ID> [MODULO_N] [--dry-run] [--force]
npm run sync-course -- <ruta/al/archivo.docx> [MODULO_N] --area <area> --plataforma <plataforma> [--estado <estado>] [--titulo <titulo>] [--dry-run] [--force]
```

`npm run convert` escribe la salida en `workspace/<slug-del-docx>/`:

```
workspace/<slug>/
  modules/01-titulo-modulo.md
  modules/02-otro-modulo.md
  media/image1.png
  manifest.json
  report.txt
```

Si `workspace/<slug>/manifest.json` ya existe, la conversión se reusa tal
cual está: no se vuelve a invocar pandoc ni a reconvertir. Para forzar una
reconversión, borrá la carpeta `workspace/<slug>/` a mano.

`npm run blocks -- <ruta/al/modulo.md>` toma un `.md` ya generado por
`npm run convert` (típicamente `workspace/<slug>/modules/NN-titulo.md`) y
vuelca por stdout el JSON de bloques de Notion resultante (`{ blocks, images
}`), sin escribir nada nuevo en disco. Sirve para revisar a mano el mapeo
markdown → Notion antes de subirlo de verdad.

`npm run push -- --modulo <ruta.md> --media <mediaDir> --parent <PARENT_PAGE_ID>
[--dry-run] [--force]` sube **un** módulo puntual a Notion, como subpágina de
`PARENT_PAGE_ID`. Requiere `NOTION_TOKEN` seteado en el entorno o en un
`.env` en la raíz del proyecto (ver `.env.example`). `--dry-run` calcula los
bloques y las imágenes referenciadas e imprime el resumen sin tocar la red.
`outDir` (donde vive `.notion-sync-state.json`, el estado reanudable) se
deriva como la carpeta padre de `--media` — típicamente
`workspace/<slug>/`. El título y el número de módulo se toman de
`manifest.json` en `outDir` si existe (buscando la entrada cuyo número
coincide con el prefijo `NN-` del nombre de archivo de `--modulo`); si no
hay `manifest.json`, se reconstruyen del nombre de archivo
(`NN-titulo-slug.md`), lo que da un título degradado (sin acentos ni
mayúsculas, por cómo funciona `slugify` en `SPEC 01`). Un módulo que ya
quedó `done` en el estado se salta sin tocar la red; una página a medias de
un intento anterior se archiva (`in_trash`) y se rehace. Con `--force` se
rehace explícitamente un módulo aunque ya haya quedado `done`: la página
vieja se archiva igual y la nueva se crea en la misma posición donde estaba
la vieja dentro de la lista de subpáginas del padre, no al final. Correr sin
`--dry-run` requiere una página padre real de Notion — no hay chequeo de
acceso a esa página en esta versión del CLI (`SPEC 05`), así que un
`PARENT_PAGE_ID` inválido falla recién al intentar crear la página.

`npm run sync -- <ruta/al/archivo.docx> <PARENT_PAGE_ID> [MODULO_N]
[--dry-run] [--force]` convierte el `.docx` completo y sube **todos** sus
módulos a Notion en una sola corrida, o uno puntual si se pasa `MODULO_N`.
Requiere `NOTION_TOKEN` igual que `npm run push`. La conversión
(`convertDocx`) corre siempre, tenga o no `--dry-run` — es local y cacheada,
igual que `npm run convert`; `--dry-run` solo afecta las etapas que tocan la
red. Si se pasa `MODULO_N` y no existe, el error es `"No hay módulo N. Van
del 1 al <total>."` e imprime antes de intentar ninguna llamada de red.
Antes de subir nada (salvo con `--dry-run`, que se salta este paso) chequea
acceso a la página padre con `GET /pages/:id` e imprime su título; si falla,
muestra un mensaje de ayuda (token de integración, página compartida con
esa integración, id correcto sin el `?v=…`) y aborta. Después recorre los
módulos en orden llamando a `pushModule` uno por uno — mismo comportamiento
de reanudación que `npm run push` (un módulo ya `done` se salta, una página
a medias de un intento previo se archiva y se rehace) pero **sin**
`try/catch` por módulo: un error en cualquiera aborta el resto de la corrida
sin seguir con los siguientes (decisión explícita, ver `SPEC 05`). El estado
ya guardado permite resumir donde quedó con una corrida siguiente.
`--force` requiere pasar `MODULO_N` — forzar el rehacer de una corrida
completa no está permitido, y sin `MODULO_N` el CLI corta con un error de
uso antes de convertir el `.docx` o tocar la red. Con `MODULO_N`, rehace ese
módulo puntual reposicionando la página nueva en el lugar exacto donde
estaba la vieja (mismo mecanismo que `npm run push --force`).

`npm run sync-course -- <ruta/al/archivo.docx> [MODULO_N] --area <area>
--plataforma <plataforma> [--estado <estado>] [--titulo <titulo>] [--dry-run]
[--force]` (`SPEC 08`) resuelve el `parent` automáticamente en vez de
recibirlo como argumento — es el comando de uso diario, sin distinguir
"primera vez" de "curso ya conocido" a nivel de invocación. Calcula el
`slug` (mismo `slugify` que el resto del pipeline) y el hash sha256 del
`.docx` (`hashFile`), y busca el slug en `<workspaceRoot>/course-registry.json`
(`SPEC 07`):

- **Slug ya registrado**: usa el `pageId` guardado como parent y delega en
  `runSync` tal cual (no exige `--area`/`--plataforma`; si se pasan, se
  ignoran). Si `!dryRun` y `runSync` no lanza, actualiza el registro
  (`upsertCourse` + `saveRegistry`) y hace `PATCH` de `Módulos` +
  `Última sincronización` en la fila de Notion.
- **Slug nuevo**: requiere `--area` y `--plataforma` (error de uso claro
  antes de tocar la red si faltan), y `NOTION_CURSOS_DATABASE_ID` seteado
  (error de configuración antes de llamar a `createCourse`, incluso con
  `--dry-run`). Arma las properties de la fila (título por defecto:
  basename del `.docx` "prettified" — guiones/underscores a espacios, cada
  palabra capitalizada — salvo que se pase `--titulo`; `--estado` por
  defecto `"Terminado"`, se escribe una sola vez, nunca se actualiza en
  corridas posteriores). Con `--dry-run` solo imprime esas properties y el
  hash calculado, sin crear nada ni seguir al push de módulos. Sin
  `--dry-run`: crea la fila (`createCourse`) → guarda el registro
  (`upsertCourse` + `saveRegistry`, para que una corrida siguiente no
  duplique la fila aunque el push de módulos falle a mitad de camino) →
  delega en `runSync` → si no lanzó, `PATCH` de `Módulos` + `Última
  sincronización`.

Precondición manual (no la crea el script): la base `Cursos` real debe tener
ya las properties `Última sincronización` (date) y `Archivo origen` (text)
en su esquema, y `NOTION_CURSOS_DATABASE_ID` debe apuntar a esa base en
`.env`. `--area`/`--plataforma`/`--estado` son strings libres (sin lista
cerrada validada en código) que se mandan tal cual al `select` de Notion.

La versión de la API de Notion (`NOTION_VERSION` en `src/notion-client/client.ts`)
queda **pinneada a mano** (`2026-03-11`); si Notion la deprecara, hay que
actualizarla en el código — no hay chequeo automático.

## Estructura de archivos

### `src/docx-to-md/`

| Archivo | Responsabilidad |
| --- | --- |
| `types.ts` | Tipos compartidos del pipeline (`Unit`, `ClassifiedKind`, `Manifest`, `ConvertOptions`, etc.). |
| `unescape.ts` | Deshace el escapado de pandoc (`unescapeAll`, `unescapeProse`) y limpia autoenlaces (`stripAutolinks`, `isAutolinkLine`). |
| `tokenizer.ts` | Agrupa las líneas crudas de pandoc en unidades estructurales: heading, lista, quote, párrafo, fence, imagen. |
| `classifier/score.ts` | Clasifica una línea individual como código o prosa. Dos capas: primero los casos límite documentados en el prototipo como `DEFECTO N` (autoenlaces, sangría NBSP, freno de prosa por conectores del español, negrita-como-sentencia, `mixedProse`, rótulos de archivo/español, comentario de cola `//`) deciden de forma terminante; si ninguno aplica, cae al motor de puntaje (`KEYWORD_START`, `SHELL_START`, `API_TOKENS`, sintaxis dura) que decide entre código y `unknown` — nunca prosa por sí solo. También vive acá `stripWholeLineEmphasis` (aunque conceptualmente es de emisión) porque el propio clasificador la necesita; `render.ts` la reexporta en vez de duplicarla. |
| `classifier/units.ts` | Clasifica una unidad completa (mayoría con sesgo entre sus líneas), resuelve `unknown` por vecindad (`resolveUnknowns`) y fusiona bloques de código partidos por una línea corta mal clasificada (`fuseSplitBlocks`, `DEFECTO 4`). |
| `language.ts` | Detecta el lenguaje de un bloque de código ya armado: html, bash, json, css, typescript o javascript por defecto (`DEFECTO 8`). |
| `render.ts` | Arma el markdown final de un módulo: agrupa unidades de código consecutivas en fences (separando raíces JSON pegadas y cortando en `</html>`), une asignaciones partidas por Word, y emite headings/listas/citas/imágenes/párrafos. |
| `modules.ts` | Divide las unidades en módulos por cada H1 (`splitModules`) y detecta/descarta el módulo de índice o tabla de contenido (`isIndexModule`, `removeIndexModule`), además de `slugify`. |
| `pandoc.ts` | Invoca pandoc (`docx` → markdown crudo + medios extraídos). Si pandoc no está en el `PATH`, lanza un mensaje de error específico y legible (no el genérico que resultaría de portar la condición del prototipo tal cual). |
| `convert.ts` | Orquesta todo lo anterior: reuso de caché por `manifest.json`, pandoc → tokenizer → módulos → clasificación → render, escritura de `modules/`, `media/`, `manifest.json` y `report.txt`. |

### `src/md-to-notion/`

| Archivo | Responsabilidad |
| --- | --- |
| `types.ts` | Tipos del mapeo markdown → Notion (`RichText`, `RichTextAnnotations`, `NotionBlock`, `ImageMode`, `MdToBlocksOptions`, `MdToBlocksResult`). Interfaces propias y mínimas, no el SDK oficial de Notion (`@notionhq/client` se evalúa en `SPEC 03`, que es la que toca la red). |
| `rich-text.ts` | Rich text en línea: `parseInline` (negrita, cursiva, código, enlaces `[texto](url)`, URLs sueltas, escapes de pandoc), `makeText`, `annotate`, y `splitRichText` (parte cualquier fragmento de más de 2000 caracteres, cortando en espacio/salto de línea cuando es posible). Constantes `MAX_TEXT`/`MAX_BLOCKS`. |
| `lang.ts` | `NOTION_LANGS` (lista cerrada de lenguajes que acepta el bloque `code` de Notion) y `safeLang` (normaliza y cae a `'plain text'` si el lenguaje no está soportado). |
| `blocks.ts` | `mdToBlocks`: mapea línea/estructura de markdown a bloque de Notion — headings `#`/`##`/`###`, párrafo, fence de código, listas con viñeta anidadas por indentación de a 4 espacios (`takeList`, reconstruye el árbol por `children`), listas numeradas anidadas de la misma forma (`takeNumberedList`, produce `numbered_list_item`, `SPEC 04`), imágenes en modo `'callout'` (marcador visible) o `'marker'` (placeholder con token, para que `SPEC 03` lo reemplace tras subir el archivo), y el primer `# Título` como título de página en vez de bloque. También `batch` (agrupa bloques de a 100, límite de bloques por request de la API de Notion). |

### `src/notion-client/`

| Archivo | Responsabilidad |
| --- | --- |
| `types.ts` | Tipos del cliente y del estado reanudable (`HttpMethod`, `NotionRequestExtra`, `ModuleState`, `ParentState`, `SyncState`, `PushModuleInput`). |
| `client.ts` | `loadEnv` (lee un `.env` simple sin pisar variables ya seteadas en el entorno) y `notion` (wrapper de `fetch` nativo con rate-limit `MIN_INTERVAL_MS` ~3 req/s, reintentos hasta `MAX_RETRIES`, respeta `Retry-After` en 429 y hace backoff exponencial en 5xx). Sin `@notionhq/client` ni otro SDK oficial. |
| `images.ts` | `uploadImage` (reserva → envía contenido → devuelve `file_upload` id; valida el límite `MAX_UPLOAD` de 20 MiB; mapea extensión a `Content-Type` con `MIME`, cayendo a `application/octet-stream` si no está en la lista) y `resolveImages` (sustituye los bloques `_marker` de `SPEC 02` por bloques `image` reales, o deja el bloque de texto original si falta el id). |
| `state.ts` | `statePath`, `loadState` y `saveState`: persisten `.notion-sync-state.json` en `outDir`, qué módulo ya quedó `done` y bajo qué `pageId`, por cada página padre. |
| `registry.ts` | `registryPath`, `loadRegistry`, `saveRegistry` y `upsertCourse`: persisten `<workspaceRoot>/course-registry.json` (registro cross-course, separado de `.notion-sync-state.json`), guardando por `slug` el `pageId` de la fila en `Cursos`, nombre y hash del `.docx` origen, y fechas de alta/última sincronización. `upsertCourse` muta el registro en el lugar y lanza si el mismo `slug` ya está registrado con otro `docxFileName` (colisión por truncamiento). Wireado en `src/cli/sync-course.ts` (`SPEC 08`). |
| `hash.ts` | `hashFile(path)`: sha256 hex del contenido completo de un archivo (`readFileSync`, sin streaming — los `.docx` de curso pesan pocos MB). Usado por `sync-course.ts` para trackear el hash del `.docx` en el registro (`SPEC 08`). |
| `course.ts` | `createCourse(databaseId, properties)`: `POST /pages` con `parent: { database_id }`, mapea `CourseProperties` a las properties crudas de Notion (`Título`, `Área`, `Plataforma`, `Estado`, `Módulos`, `Archivo origen`, `Última sincronización`) y devuelve el `pageId` de la fila creada. `updateCourseAfterSync(pageId, modulos)`: `PATCH` que solo toca `Módulos` y `Última sincronización` — no reconstruye el resto de las properties, que quedan fijas desde la creación (`SPEC 08`). |
| `push-module.ts` | `pushModule`: orquesta la subida de un módulo puntual — salta si ya está `done` (salvo `force: true`), archiva (`in_trash`) una página de un intento previo incompleto o de un rehacer forzado (tolera que el archivado falle si la página ya no existe), sube imágenes, resuelve markers, crea la página con el primer lote de bloques (reposicionada con `position` en el lugar de la vieja: hermano anterior entre los hijos actuales del padre, o el módulo anterior más cercano que siga presente, o `page_start`) y hace `PATCH` del resto, guardando el estado después de crear la página y de nuevo al terminar. `dryRun` no toca la red. |

### `src/cli/`

| Archivo | Responsabilidad |
| --- | --- |
| `convert.ts` | Entrypoint de `npm run convert -- <ruta.docx>`. Llama a `convertDocx`, imprime el reporte y la carpeta de salida, o el error con código de salida distinto de cero. |
| `blocks.ts` | Entrypoint de `npm run blocks -- <ruta/al/modulo.md>`. Llama a `mdToBlocks` sobre el markdown leído e imprime `{ blocks, images }` por stdout como JSON, sin tocar disco. |
| `push.ts` | Entrypoint de `npm run push -- --modulo <ruta.md> --media <mediaDir> --parent <PARENT_PAGE_ID> [--dry-run] [--force]`. Parseo manual de flags, deriva `outDir` de `--media`, resuelve `PushModuleInput` desde `manifest.json` o el nombre de archivo, y llama a `loadEnv` + `pushModule` con el `force` parseado. |
| `sync.ts` | Entrypoint de `npm run sync -- <archivo.docx> <PARENT_PAGE_ID> [MODULO_N] [--dry-run] [--force]`. `parseArgv` (posicionales + `--dry-run`/`--force` en cualquier posición) separado de `runSync` (orquestación testeable sin pasar por `process.argv`) y de `main()`. `runSync` valida primero que `--force` no venga sin `MODULO_N` (error de uso, corta antes de convertir el `.docx` o tocar la red), convierte el `.docx` (`convertDocx`, siempre), filtra `manifest.modules` por `MODULO_N` si vino, chequea acceso a la página padre (`GET /pages/:id`) salvo con `--dry-run`, y recorre los módulos filtrados llamando a `pushModule` en orden con el `force` recibido, sin `try/catch` por módulo — un error aborta el resto de la corrida. |
| `sync-course.ts` | Entrypoint de `npm run sync-course -- <archivo.docx> [MODULO_N] --area <area> --plataforma <plataforma> [--estado <estado>] [--titulo <titulo>] [--dry-run] [--force]` (`SPEC 08`). `parseArgv`, `prettifyTitle` (basename del `.docx` a título "prettified") y `runSyncCourse` (resuelve el `parent` automáticamente vía `course-registry.json`, creando la fila en `Cursos` con `createCourse` si el slug es nuevo, y delega siempre en `runSync` de `sync.ts` — sin modificarlo — para subir los módulos) separados de `main()`. No acepta `PARENT_PAGE_ID` como argumento; ver el detalle de la orquestación en "Instalar y correr". |

## Tests

- Conviven con el código en una carpeta `__tests__/` por módulo (ej.
  `src/docx-to-md/__tests__/unescape.test.ts`), con el mismo nombre base que
  el archivo que prueban.
- El tokenizer y el clasificador se prueban con fixtures de texto escritos a
  mano — no invocan pandoc, y corren en cualquier máquina.
- `pandoc.test.ts` sí invoca pandoc real (generando un `.docx` mínimo al
  vuelo con el propio pandoc, sin commitear ningún archivo de muestra); esos
  tests se saltan automáticamente si pandoc no está instalado en la máquina
  que corre los tests. **Validar el pipeline completo requiere tener pandoc
  instalado localmente.**
- Los tests de `src/md-to-notion/` usan fixtures de markdown escritos a mano
  y no invocan pandoc ni red. La comparación 1:1 del JSON de bloques contra
  `references/notion-sync.js` (Parte 2) se hace a mano sobre los módulos
  reales de un `.docx` ya convertido (no está en CI, ese `.docx` tampoco se
  commitea).
- Los tests de `src/notion-client/` mockean `fetch` global y usan
  `vi.useFakeTimers()` para el rate-limit/reintentos/backoff, sin depender
  de esperas reales ni de red. Subir un módulo de verdad contra la API real
  de Notion (con `NOTION_TOKEN` y una página padre reales) se valida a
  mano, no está en CI.

## Notas de diseño

- **`safeLang`/lista de lenguajes de Notion**: `render.ts` (`SPEC 01`) emite
  el fence con el lenguaje que devuelve `detectLanguage` directo, sin
  mapearlo a la lista cerrada de Notion. Ese mapeo es responsabilidad de la
  etapa markdown → Notion y vive en `src/md-to-notion/lang.ts` (`SPEC 02`).
- **`mixedProse`** usa un regex genérico para "quitarle la sintaxis" a una
  línea y ver si sobra una oración en español. Ese regex puede interpretar
  una palabra suelta seguida de paréntesis (`y (...)`) como si fuera una
  llamada de función y comérsela del residuo — es un comportamiento heredado
  del prototipo, no algo introducido en el port.
- **Reuso de caché**: es deliberadamente simple (si `manifest.json` existe,
  no se reconvierte). No invalida por hash del `.docx` origen ni distingue
  si una conversión previa se hizo con un filtro `only` activo — correr sin
  filtro después de una corrida filtrada reusaría un manifest incompleto.
  Esto se resuelve en una spec futura (`course-registry`).
