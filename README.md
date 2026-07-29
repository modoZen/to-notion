# to-notion

Convierte documentos Word (apuntes de curso: módulos, prosa, snippets de
código, imágenes) en subpáginas de Notion, colgadas de la fila del curso
correspondiente en una base `Cursos`. El pipeline completo tiene dos etapas:

1. `.docx` → markdown + imágenes extraídas (cacheado en disco, revisable por
   un humano). **Esto es lo que hay implementado hasta ahora** (`SPEC 01`).
2. markdown → bloques de Notion, subidos vía la API (`SPEC 02` en adelante,
   todavía no implementado).

Este repo es público. Los `.docx` de origen y todo lo generado en
`workspace/` (markdown, imágenes, manifest) son contenido de cursos pagos
(Udemy, Platzi, etc.) y nunca se commitean — ver `.gitignore`.

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

### `src/cli/`

| Archivo | Responsabilidad |
| --- | --- |
| `convert.ts` | Entrypoint de `npm run convert -- <ruta.docx>`. Llama a `convertDocx`, imprime el reporte y la carpeta de salida, o el error con código de salida distinto de cero. |

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

## Notas de diseño

- **`safeLang`/lista de lenguajes de Notion**: el prototipo mapea el
  lenguaje detectado a la lista cerrada de lenguajes que acepta el bloque de
  código de Notion (con `'plain text'` como fallback). Ese mapeo es una
  preocupación de la etapa markdown → Notion (`SPEC 02`) y no está portado
  acá: `render.ts` emite el fence con el lenguaje que devuelve `detectLanguage`
  directo.
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
