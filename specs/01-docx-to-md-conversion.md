# SPEC 01 — Conversión de .docx a markdown (docx-to-md)

> **Status:** Aprobado
> **Depends on:** (ninguna, es la primera spec)
> **Date:** 2026-07-29
> **Objective:** Portar el pipeline .docx → markdown del prototipo (`references/notion-sync.js`, Parte 1) a un módulo TypeScript probado con Vitest, junto con el scaffold inicial del proyecto (package.json, tsconfig, configuración de tests) y un script de npm para ejecutarlo manualmente.

---

## Scope

**In:**

- Scaffold del proyecto: `package.json` (ESM, `engines.node >= 24`), `tsconfig.json` (`strict: true`), configuración de Vitest.
- Módulo `src/docx-to-md/`, puerto fiel de la Parte 1 de `references/notion-sync.js`:
  - Invocación de pandoc (`docx` → markdown crudo + medios extraídos).
  - Desescapado (`unescapeAll`, `unescapeProse`, `stripAutolinks`).
  - Tokenizado de líneas en unidades (heading/list/quote/image/fence/para).
  - Clasificador código-vs-prosa completo, con todos los heurísticos y casos `DEFECTO N` documentados en el prototipo.
  - Resolución de unidades `unknown` por vecindad y fusión de bloques partidos.
  - Detección de lenguaje del bloque de código.
  - Render final a markdown por módulo.
  - División en módulos por encabezado H1, con detección y remoción automática del índice/tabla de contenido.
  - Filtro opcional para convertir solo un módulo puntual (equivalente a `only` en el prototipo).
- Salida en `workspace/<slug-del-docx>/`: `modules/NN-slug.md`, `media/*`, `manifest.json`, `report.txt` — misma forma que el prototipo.
- Reuso de caché: si `workspace/<slug>/manifest.json` ya existe, no se vuelve a invocar pandoc ni a reconvertir.
- Script `npm run convert -- <ruta.docx>` para ejecutar la conversión manualmente y revisar el markdown resultante.
- Manejo de error si pandoc no está en el PATH: mensaje claro y salida con código distinto de cero.
- Tests de Vitest para tokenizer y clasificador, con fixtures de markdown escritos a mano que cubren cada caso `DEFECTO` documentado, sin invocar pandoc. La invocación real a pandoc se prueba aparte, en un test que se salta si pandoc no está instalado.
- Entrada en `.gitignore` para `workspace/`.
- `README.md` nuevo documentando el proyecto y el árbol de archivos (ver Implementation plan, paso 14).

**Out of scope (para specs futuras):**

- Mapeo markdown → bloques de Notion (SPEC 02, `md-to-notion`).
- Cliente de Notion y subida real de páginas/imágenes (SPEC 03, `notion-client`).
- CLI de sincronización completa (`--dry-run`, estado reanudable, orquestar docx→md y subida juntos) (SPEC 04, `sync.orchestration`).
- Registro de cursos / `course-registry.json` (SPEC 05).
- Creación de filas de curso en la base `Cursos` (SPEC 06, fase 2).
- Subida o conversión de varios `.docx` en una sola corrida (expansión futura mencionada por el usuario).
- Invalidación de caché más allá de "si `manifest.json` existe, se reusa" (por ejemplo detectar que el `.docx` cambió por hash) — eso depende del `course-registry` de la SPEC 05.

---

## Data model

```ts
// src/docx-to-md/types.ts

// Unidad intermedia producida por el tokenizer, antes de clasificar.
export type UnitType =
  | "heading"
  | "list"
  | "quote"
  | "image"
  | "fence"
  | "para";

export interface Unit {
  type: UnitType;
  level?: number; // solo 'heading'
  text?: string; // solo 'heading'
  src?: string; // solo 'image', ruta al medio extraído por pandoc
  lines?: string[]; // 'list' | 'quote' | 'para' | 'fence'
}

// Resultado del clasificador código-vs-prosa para cada unidad.
export type ClassifiedKind =
  | "code"
  | "prose"
  | "quote"
  | "heading"
  | "image"
  | "list"
  | "fence"
  | "unknown";

export interface ModuleStats {
  code: number;
  images: number;
  headings: number;
  lists: number;
  paras: number;
  quotes: number;
}

// Una entrada de manifest.json por cada módulo (H1) convertido.
export interface ConvertedModule {
  number: number;
  title: string;
  file: string; // relativo al workspace del docx, ej. "modules/01-intro.md"
  images: string[]; // nombres de archivo en media/ referenciados por este módulo
  stats: ModuleStats;
}

export interface Manifest {
  source: string; // nombre de archivo del .docx origen (sin ruta)
  generated: string; // timestamp ISO de la conversión
  modules: ConvertedModule[];
}

// Opciones de entrada para convertir un .docx.
export interface ConvertOptions {
  docxPath: string;
  workspaceRoot?: string; // default: "workspace" en la raíz del proyecto
  only?: number; // convierte solo este número de módulo
  keepIndex?: boolean; // default: false (se detecta y descarta el índice)
}
```

**Estructura en disco por `.docx` convertido** (dentro de `workspaceRoot`, p. ej. `workspace/`):

```
workspace/<slug-del-docx>/
  modules/01-titulo-modulo.md
  modules/02-otro-modulo.md
  media/image1.png
  media/image2.png
  manifest.json
  report.txt
```

Conventions:

- `<slug-del-docx>` sale de aplicar la misma función `slugify` del prototipo al nombre del `.docx` (sin extensión).
- `manifest.json` es el único archivo que indica si la conversión ya se hizo: su existencia es lo que activa el reuso de caché.
- `report.txt` es texto plano para lectura humana (una línea por módulo con sus conteos); no se parsea de vuelta, solo se regenera.
- Los nombres de archivo en `modules/` siguen el patrón `NN-slug-del-titulo.md`, igual que el prototipo.
- `media/` es una sola carpeta plana para todo el `.docx` (no una por módulo); qué imagen pertenece a qué módulo se sabe por el campo `images` de cada `ConvertedModule` en `manifest.json`, no por la ubicación en disco.

---

## Implementation plan

1. Scaffold del proyecto: `package.json` (ESM, `engines.node >= 24`), `tsconfig.json` (`strict: true`), `vitest.config.ts`, carpeta `src/docx-to-md/`, y entrada `workspace/` en `.gitignore`. Test manual: `npm install && npm test` corre sin fallar (aunque todavía no haya tests) y `npm run typecheck` pasa.
2. `src/docx-to-md/types.ts` con las interfaces de la sección de Data model (`Unit`, `ClassifiedKind`, `ModuleStats`, `ConvertedModule`, `Manifest`, `ConvertOptions`).
3. `src/docx-to-md/unescape.ts`: `unescapeAll`, `unescapeProse`, `stripAutolinks`, `isAutolinkLine`. Tests con casos reales de escapado de pandoc y autoenlaces (`<https://...>`, `<mailto:...>`).
4. `src/docx-to-md/tokenizer.ts`: `tokenize` y `classifyStructure`, incluida la extracción de imágenes en cualquier posición de la línea (sueltas, pegadas a texto, varias en una línea). Tests de agrupación de líneas en unidades y de separación de imágenes.
5. `src/docx-to-md/classifier/score.ts`: heurísticos base del clasificador de línea (`KEYWORD_START`, `SHELL_START`, `API_TOKENS`, sintaxis dura, sistema de puntaje). Tests con líneas de código y de prosa "de manual", sin los casos límite todavía.
6. Extender el clasificador con los casos `DEFECTO 1` a `9` documentados en el prototipo (autoenlaces, sangría NBSP, negrita-como-sentencia, `mixedProse`, `isFilePathLabel`, `isSpanishLabel`, comentario de cola con `//`). Un test por cada `DEFECTO`, usando el mismo texto de ejemplo del comentario original.
7. `classifyUnit`, `resolveUnknowns` y `fuseSplitBlocks`: decisión a nivel de unidad completa (mayoría con sesgo, citas) y resolución de vecindad para unidades `unknown`. Tests con unidades multi-línea y con bloques de código partidos por una línea corta tipo `count: 3`.
8. `src/docx-to-md/language.ts`: `detectLanguage`. Un test por cada lenguaje soportado (html, bash, json, css, typescript, javascript por defecto).
9. `src/docx-to-md/render.ts`: `renderModule` y sus auxiliares (`unitCodeLines`, `joinDanglingAssignments`, `splitAtDocumentEnd`, `imageMarker`, `stripWholeLineEmphasis`). Tests de segmentación de bloques de código (JSON pegados con `}{`, asignación partida en dos párrafos por Word, corte en `</html>`).
10. `src/docx-to-md/modules.ts`: `splitModules` (división por H1) y la heurística de detección/remoción del índice. Tests con y sin índice al inicio, y con el filtro `only` activo.
11. `src/docx-to-md/pandoc.ts`: `runPandoc`, con el error claro y salida no-cero si pandoc no está en el PATH. Test que se salta automáticamente si pandoc no está instalado en la máquina que corre los tests.
12. `src/docx-to-md/convert.ts`: `convertDocx(options: ConvertOptions): Manifest`, que orquesta todo lo anterior, escribe `workspace/<slug>/` (`modules/`, `media/`, `manifest.json`, `report.txt`) y reusa el caché si `manifest.json` ya existe. Tests con `runPandoc` mockeado (no dependen de pandoc real) para verificar escritura de archivos y reuso de caché.
13. `src/cli/convert.ts` + script `"convert"` en `package.json`, para poder correr `npm run convert -- <ruta.docx>` y revisar el markdown resultante a mano.
14. `README.md`: propósito del proyecto, cómo instalar/correr, y el árbol de archivos de `src/docx-to-md/` y `src/cli/` con una línea por archivo explicando su responsabilidad. Se actualiza en cada spec futura a medida que se agreguen módulos.

---

## Acceptance criteria

- [ ] `npm install` y `npm run typecheck` pasan sin errores.
- [ ] `npm test` corre y todos los tests de Vitest pasan en verde.
- [ ] Cada caso `DEFECTO 1` a `9` documentado en el prototipo tiene al menos un test que lo reproduce y pasa.
- [ ] Ejecutar `npm run convert -- <ruta a un .docx real>` genera `workspace/<slug>/modules/*.md`, `workspace/<slug>/media/*`, `workspace/<slug>/manifest.json` y `workspace/<slug>/report.txt`.
- [ ] El markdown generado para un módulo de prueba clasifica código y prosa de forma equivalente al resultado ya validado manualmente con el prototipo sobre el mismo `.docx`.
- [ ] Volver a correr `npm run convert -- <mismo .docx>` no vuelve a invocar pandoc: se reusa el `manifest.json` existente (verificable por log o porque los archivos no cambian de timestamp).
- [ ] Convertir con el filtro de módulo activo genera solo el módulo indicado, sin generar los demás.
- [ ] Un `.docx` cuyo primer módulo es un índice/tabla de contenido se descarta automáticamente del resultado.
- [ ] Si pandoc no está instalado en el PATH, `npm run convert` termina con un mensaje de error claro y código de salida distinto de cero.
- [ ] `workspace/` no aparece como archivo trackeable en `git status` (está en `.gitignore`).
- [ ] `README.md` documenta el árbol de archivos de `src/docx-to-md/` y `src/cli/`.

---

## Decisions

- **Sí:** paquete único (`src/` con carpetas por módulo) en vez de monorepo con npm workspaces. Menos ceremonia para un proyecto personal; se puede migrar a workspaces después si hace falta publicar los módulos por separado.
- **No:** monorepo con workspaces desde el día uno. Overengineering mientras el proyecto tiene un solo consumidor (este mismo repo).
- **Sí:** ESM + Node `>= 24`, aprovechando el soporte nativo de TypeScript de Node (correr `.ts` directo, sin `ts-node`/`tsx`) tanto para el script de conversión como, potencialmente, para los tests.
- **Sí:** `workspace/` como carpeta de salida fija en la raíz del proyecto, no configurable todavía. Configurabilidad (env var / config file) se pospone hasta que exista un caso real que lo necesite — el `course-registry` de la SPEC 05 es el candidato natural para introducirla.
- **No:** carpeta de salida configurable desde esta spec. Prematuro sin un segundo caso de uso que lo justifique.
- **Sí:** tests del tokenizer/clasificador con fixtures de texto escritos a mano (uno por cada `DEFECTO`), sin invocar pandoc. Permite correr `npm test` en cualquier máquina sin depender de tener pandoc instalado, y aísla la parte más frágil (la heurística) de la parte que solo se puede probar con la herramienta real.
- **No:** tests end-to-end contra un `.docx` de muestra committeado al repo. Acoplaría los tests a pandoc instalado en CI/máquina local, y el prototipo ya fue validado manualmente contra los 11 módulos reales — replicar esa validación con fixtures de texto es suficiente para esta spec.
- **Sí:** reuso de caché simple (si `manifest.json` existe, no reconvertir), igual que el prototipo. Invalidación por hash del `.docx` origen se pospone al `course-registry` (SPEC 05), que es quien va a necesitar saber si el archivo cambió para todo el pipeline, no solo para esta conversión.
- **Sí:** documentación del árbol de archivos en un `README.md` nuevo, no en el spec ni ampliando `CLAUDE.md`. El spec es un contrato de una sola pasada de implementación (se congela al pasar a `Implemented`); el `README.md` es el lugar que se sigue actualizando en cada spec futura sin quedar desactualizado.
- **No:** CLI completo con `--dry-run` y estado reanudable en esta spec. Ese es el alcance de la SPEC 04 (`sync.orchestration`); el script `npm run convert` de aquí es deliberadamente mínimo (un solo `.docx`, sin flags de red porque todavía no hay red involucrada).

---

## Risks

| Risk                                                                                                                                                                                                                                                        | Mitigation                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Al portar la heurística línea por línea de JS a TypeScript, alguna sutileza (orden de evaluación, comportamiento de una regex) cambia el resultado de clasificación respecto al prototipo ya validado.                                                      | Los tests con un fixture por cada `DEFECTO` son la red de seguridad mínima; antes de cerrar la spec, correr el módulo nuevo contra el mismo `.docx` real que ya validó el prototipo y comparar el markdown resultante. |
| Node `>= 24` es una versión reciente; su ejecución nativa de TypeScript (type-stripping) tiene límites conocidos (no soporta todas las construcciones de TS, ej. enums en algunos modos) que podrían chocar con `strict: true` o con algo usado en el port. | Si aparece una limitación real, caer a compilar con `tsc` antes de ejecutar en vez de depender solo de la ejecución nativa, y dejarlo anotado como decisión revisada.                                                  |
| Distintas versiones de pandoc instaladas en distintas máquinas pueden producir markdown crudo ligeramente distinto, afectando al tokenizer de formas no cubiertas por los fixtures.                                                                         | Documentar en el `README.md` la versión de pandoc usada para validar (la misma que ya usaba el prototipo).                                                                                                             |
| El test de `runPandoc` se salta en máquinas sin pandoc instalado, dando falsa sensación de cobertura completa si no se lee el output con atención.                                                                                                          | El reporte de Vitest deja explícito qué test se saltó; se documenta en el `README.md` que validar el pipeline completo requiere tener pandoc instalado localmente.                                                     |

---

## What is **not** in this spec

- Mapeo markdown → bloques de Notion (otra spec).
- Cliente de Notion y subida real de páginas/imágenes (otra spec).
- CLI de sincronización completa con `--dry-run` y estado reanudable (otra spec).
- Registro de cursos / `course-registry.json` (otra spec).
- Creación de filas de curso en la base `Cursos` (fase 2).
- Subida o conversión de varios `.docx` en una sola corrida.
- Invalidación de caché por hash del `.docx` origen.

Cada uno de estos, si se implementa, va en su propia spec.
