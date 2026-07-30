# SPEC 02 — Mapeo de markdown a bloques de Notion (md-to-notion)

> **Status:** Aprobado
> **Depends on:** SPEC 01 (formato del markdown de entrada)
> **Date:** 2026-07-29
> **Objective:** Portar fielmente la Parte 2 del prototipo (`references/notion-sync.js`, líneas 963-1270) a un módulo TypeScript probado con Vitest (`src/md-to-notion/`), incluyendo un script de CLI para inspeccionar a mano el JSON de bloques resultante de un módulo ya convertido por SPEC 01.

---

## Scope

**In:**

- Módulo `src/md-to-notion/`, puerto fiel de la Parte 2 de `references/notion-sync.js`:
  - Rich text inline: `parseInline` (negrita, cursiva, código en línea, enlaces `[texto](url)`, URLs sueltas, escapes de pandoc), `makeText`, `annotate`.
  - División de rich text en fragmentos de máximo 2000 caracteres (`splitRichText`), cortando en espacio/salto de línea cuando es posible.
  - Mapeo de línea/estructura a bloque de Notion (`mdToBlocks`): headings `#`/`##`/`###` → `heading_1/2/3`, listas con viñeta (anidadas vía `children`, profundidad por indentación de a 4 espacios), código (fence ```) → bloque `code` con lenguaje mapeado a la lista cerrada de Notion (`safeLang`/`NOTION_LANGS`), imágenes → bloque `callout`o marcador`paragraph`con token según`imageMode`, párrafo por defecto para el resto.
  - Los dos modos de imagen del prototipo: `'callout'` (marcador visible, sin subir archivo) y `'marker'` (placeholder con token en el caption, para que SPEC 03 lo reemplace tras subir).
  - Loteo de bloques de a 100 (`batch`), límite de bloques por request de la API de Notion.
- Interfaces TS propias y mínimas para el bloque de Notion (no se agrega `@notionhq/client` como dependencia en esta spec).
- Script `npm run blocks -- <ruta/al/modulo.md>` que corre el mapeo sobre un `.md` ya generado por SPEC 01 y vuelca el JSON de bloques resultante por stdout, para revisión manual sin depender de SPEC 03.
- Tests de Vitest con fixtures de markdown escritos a mano, sin invocar pandoc ni red.
- Comparación del JSON de bloques generado contra el que produce `references/notion-sync.js` (Parte 2) corriendo ambos sobre los `.md` reales ya generados por SPEC 01 (mismo `.docx` de validación usado en esa spec).
- Actualización de `README.md` con el árbol de archivos de `src/md-to-notion/` (mismo formato que la tabla de `src/docx-to-md/`).

**Out of scope (para specs futuras):**

- Cliente de Notion y subida real de páginas/imágenes (SPEC 03, `notion-client`).
- CLI de sincronización completa (`--dry-run`, estado reanudable, orquestar docx→md y subida juntos) (SPEC 04, `sync.orchestration`).
- Registro de cursos / `course-registry.json` (SPEC 05).
- Creación de filas de curso en la base `Cursos` (SPEC 06, fase 2).
- Bloque de cita real de Notion (`quote`) para líneas `> texto`: el prototipo no las reconoce y caen como párrafo con el `>` literal. Se documenta como riesgo conocido (no aparece en el `.docx` real ya validado).
- Listas numeradas (`1. texto`) como `numbered_list_item` de Notion: el prototipo solo reconoce viñetas y las numeradas caen como párrafo suelto. Se documenta como riesgo conocido (no aparece en el `.docx` real ya validado).
- Encabezados H4-H6 como bloque heading de Notion (Notion no tiene heading por debajo de H3): el prototipo los deja caer a párrafo con los `#` literales visibles. Se documenta como riesgo conocido (no aparece en el `.docx` real ya validado).
- Uso de `@notionhq/client` u otro SDK oficial de Notion (se evalúa en SPEC 03, que es la que efectivamente toca la red).

---

## Data model

```ts
// src/md-to-notion/types.ts

export interface RichTextAnnotations {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export interface RichText {
  type: "text";
  text: { content: string; link?: { url: string } };
  annotations?: RichTextAnnotations;
}

export type NotionBlock =
  | {
      object: "block";
      type: "heading_1";
      heading_1: { rich_text: RichText[]; is_toggleable: false };
    }
  | {
      object: "block";
      type: "heading_2";
      heading_2: { rich_text: RichText[]; is_toggleable: false };
    }
  | {
      object: "block";
      type: "heading_3";
      heading_3: { rich_text: RichText[]; is_toggleable: false };
    }
  | {
      object: "block";
      type: "paragraph";
      paragraph: { rich_text: RichText[] };
      _marker?: string;
    }
  | {
      object: "block";
      type: "bulleted_list_item";
      bulleted_list_item: { rich_text: RichText[]; children?: NotionBlock[] };
    }
  | {
      object: "block";
      type: "code";
      code: { language: string; rich_text: RichText[] };
    }
  | {
      object: "block";
      type: "callout";
      callout: {
        icon: { type: "emoji"; emoji: string };
        color: string;
        rich_text: RichText[];
      };
    };

export type ImageMode = "callout" | "marker";

export interface MdToBlocksOptions {
  imageMode?: ImageMode; // default: 'callout'
}

export interface MdToBlocksResult {
  blocks: NotionBlock[];
  images: string[]; // tokens de imagen (nombre de archivo) referenciados, en orden de aparición
}
```

Conventions:

- `_marker` en un bloque `paragraph` es el token de imagen pendiente de reemplazo (solo aparece en modo `'marker'`); lo consume SPEC 03, no se lee en esta spec.
- `NotionBlock` cubre únicamente los tipos que el mapeo produce hoy — no es un tipo genérico de la API de Notion (eso, si hace falta, es responsabilidad de `@notionhq/client` en SPEC 03).
- `RichText.text.content` nunca supera 2000 caracteres (`splitRichText` garantiza el corte); un párrafo/heading/list item con texto largo se representa como **un array de varios `RichText`** dentro del mismo `rich_text`, no como varios bloques.

---

## Implementation plan

1. `src/md-to-notion/types.ts` con las interfaces de la sección de Data model (`RichText`, `RichTextAnnotations`, `NotionBlock`, `ImageMode`, `MdToBlocksOptions`, `MdToBlocksResult`).
2. `src/md-to-notion/rich-text.ts`: `parseInline`, `makeText`, `annotate`, `splitRichText`, y las constantes `MAX_TEXT`/`MAX_BLOCKS`. Tests: negrita, cursiva, código en línea, enlaces `[texto](url)`, URL suelta, escapes de pandoc (`\*`, `\_`, `` \` ``, `\#`, `\\`), anidamiento negrita+cursiva, y corte de un texto de más de 2000 caracteres en espacio/salto de línea.
3. `src/md-to-notion/lang.ts`: `NOTION_LANGS` (lista cerrada) y `safeLang`. Tests: lenguaje soportado pasa igual, lenguaje no soportado cae a `'plain text'`, mayúsculas/espacios se normalizan.
4. `src/md-to-notion/blocks.ts`: `mdToBlocks` para heading (`#`/`##`/`###`), párrafo y fence de código, sin listas ni imágenes todavía. Tests con markdown de un módulo real simplificado.
5. Extender `blocks.ts` con `takeList` (listas con viñeta anidadas por indentación de a 4 espacios, reconstrucción del árbol por `children`). Tests con lista simple, lista anidada a dos niveles, y lista cortada por una línea en blanco seguida de más lista.
6. Extender `blocks.ts` con `imageBlock` y los dos modos (`'callout'`, `'marker'`), y el manejo de la primer línea `# Título` como título de página (no bloque). Tests para cada modo y para el caso sin título.
7. `batch(blocks, size = MAX_BLOCKS)` en `blocks.ts`. Test con más de 100 bloques y con menos de 100.
8. `src/cli/blocks.ts` + script `"blocks"` en `package.json`, para poder correr `npm run blocks -- <ruta/al/modulo.md>` (típicamente un archivo ya generado por SPEC 01 en `workspace/<slug>/modules/NN-titulo.md`) y ver por stdout el JSON de bloques resultante, sin escribir nada nuevo en disco.
9. Comparación manual (no automatizada en CI, pero documentada) del JSON de bloques generado por `mdToBlocks` contra el de `references/notion-sync.js` (Parte 2), corriendo ambos sobre los módulos reales ya generados en SPEC 01 para el `.docx` de validación.
10. `README.md`: agregar la tabla de `src/md-to-notion/` y `src/cli/blocks.ts`, siguiendo el mismo formato que la tabla de `src/docx-to-md/`.

---

## Acceptance criteria

- [ ] `npm run typecheck` y `npm test` pasan sin errores con los nuevos archivos de `src/md-to-notion/`.
- [ ] Cada función de la sección Data model tiene al menos un test: `parseInline`, `splitRichText`, `safeLang`, `mdToBlocks` (heading, párrafo, código, lista con viñeta anidada, imagen en ambos modos), `takeList`, `batch`.
- [ ] Un heading `#`, `##` o `###` se mapea a `heading_1`/`heading_2`/`heading_3` respectivamente, con `is_toggleable: false`.
- [ ] Un fence de código con lenguaje soportado por Notion se mapea a un bloque `code` con ese lenguaje; un lenguaje no soportado cae a `'plain text'`.
- [ ] Una lista con viñeta anidada a dos niveles produce un `bulleted_list_item` con el hijo dentro de `children`, no un bloque plano.
- [ ] Una imagen (`![](image1.png)`) en modo `'callout'` produce un bloque `callout` con el ícono 🖼️ y el marcador como texto en código; en modo `'marker'` produce un bloque `paragraph` con `_marker` seteado al token.
- [ ] Un texto de más de 2000 caracteres en un párrafo se parte en múltiples fragmentos de `rich_text`, cortando en espacio cuando es posible, sin superar los 2000 caracteres por fragmento.
- [ ] Más de 100 bloques generados por `mdToBlocks` se agrupan correctamente en lotes de a 100 con `batch`.
- [ ] `npm run blocks -- <ruta/al/modulo.md>` corre sobre un `.md` real ya generado por SPEC 01 e imprime el JSON de bloques por stdout sin errores.
- [ ] El JSON de bloques generado por `mdToBlocks` sobre los módulos reales del `.docx` de validación de SPEC 01 es idéntico al que produce `references/notion-sync.js` (Parte 2) sobre los mismos módulos. (Verificado a mano, no en CI — ese `.docx` no se commitea.)
- [ ] `README.md` documenta el árbol de archivos de `src/md-to-notion/` y `src/cli/blocks.ts`.

---

## Decisions

- **Sí:** port fiel de la Parte 2 del prototipo, sin arreglar los desajustes encontrados entre lo que el markdown de SPEC 01 puede producir y lo que `mdToBlocks` reconoce (citas, listas numeradas, headings H4-H6). Se reconsideró arreglarlos, pero el `.docx` real ya validado en SPEC 01 no contiene ninguno de esos tres casos — arreglarlos ahora impediría además la comparación 1:1 contra el prototipo, que es la red de seguridad principal de esta spec.
- **No:** bloque `quote` real de Notion para líneas `> texto` en esta spec. Documentado como riesgo conocido, se arregla en una spec futura si aparece un curso real que lo necesite.
- **No:** `numbered_list_item` de Notion para listas numeradas de origen. Mismo motivo: no aparece en el corpus ya validado.
- **No:** clamp de H4-H6 a `heading_3`. Mismo motivo: no aparece en el corpus ya validado; además así el prototipo y el puerto siguen siendo diffables sin excepciones.
- **Sí:** portar los dos modos de imagen (`'callout'` y `'marker'`), tal como documenta `CLAUDE.md` como diseño intencional del prototipo — `'callout'` es candidato natural para un futuro `--dry-run` en SPEC 04.
- **Sí:** interfaces TS propias y mínimas para los bloques de Notion (`src/md-to-notion/types.ts`), sin agregar `@notionhq/client` como dependencia. Solo la Parte 3 (SPEC 03) toca la red; agregar el SDK acá sería una dependencia usada solo por sus tipos, sin ejecutar código real contra la API todavía. Se reconsideró explícitamente al desarrollar la sección de Data model y se mantuvo la decisión original.
- **Sí:** script `npm run blocks -- <ruta/al/modulo.md>` que imprime el JSON de bloques por stdout, sin escribir ningún archivo nuevo en disco. Permite revisar el mapeo a mano (contra un `.md` real de `workspace/<slug>/modules/`) sin esperar a SPEC 03, y la comparación contra el prototipo se resuelve igual con redirección manual puntual (`> archivo.json`), sin necesidad de persistir un artefacto que no se vuelve a usar después.
- **No:** que el CLI escriba automáticamente un `.blocks.json` junto al `.md` de origen. No ahorra pasos en la comparación manual y agregaría un archivo generado permanente a `workspace/` en cada conversión futura.
- **Sí:** incluir el loteo de a 100 bloques (`batch`) en esta spec, no en SPEC 03. `CLAUDE.md` ya describe el límite de 100 bloques por request como parte de la etapa de mapeo (junto con el límite de 2000 caracteres), no de la etapa de cliente/subida.

---

## Risks

| Risk                                                                                                                                                                                                                                             | Mitigation                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Una cita (`> texto`), lista numerada o heading H4-H6 real aparece en un curso futuro no cubierto por el `.docx` de validación de SPEC 01, y Notion recibe el marcador literal (`>`, `####`) como texto plano en vez del bloque correcto.         | Documentado explícitamente en Scope/Decisions como gap conocido; si aparece un caso real, se arregla en una spec chica dedicada (ver estos tres casos) antes de seguir con SPEC 03/04. |
| El corpus de validación (`.docx` de "Curso Profesional de JavaScript") no ejercita todos los lenguajes de `NOTION_LANGS` ni todas las combinaciones de rich text anidado (negrita+cursiva+link), dejando ramas sin comparar contra el prototipo. | Los tests unitarios con fixtures cubren cada rama por separado (uno por lenguaje, uno por combinación de anotaciones), independientemente de si aparece en el corpus real.             |
| El script `npm run blocks` no persiste nada: si se necesita repetir la comparación manual contra el prototipo más adelante (por ejemplo al tocar `rich-text.ts` en una spec futura), hay que regenerar ambos JSON a mano de nuevo.               | Aceptado como costo del enfoque "solo stdout" (ver Decisions); es un paso manual puntual, no una tarea recurrente de CI.                                                               |

---

## What is **not** in this spec

- Cliente de Notion y subida real de páginas/imágenes (otra spec, SPEC 03).
- CLI de sincronización completa con `--dry-run` y estado reanudable (otra spec, SPEC 04).
- Registro de cursos / `course-registry.json` (otra spec, SPEC 05).
- Creación de filas de curso en la base `Cursos` (fase 2, SPEC 06).
- Bloque de cita real (`quote`) para líneas `> texto` — queda como el prototipo, párrafo con el `>` literal.
- `numbered_list_item` para listas numeradas de origen — queda como el prototipo, párrafo suelto sin el número.
- Clamp de encabezados H4-H6 a `heading_3` — queda como el prototipo, párrafo con los `#` literales.
- Uso de `@notionhq/client` u otro SDK oficial de Notion.

Cada uno de estos, si se implementa, va en su propia spec.
