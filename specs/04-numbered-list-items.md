# SPEC 04 — Listas numeradas en mdToBlocks (numbered-list-items)

> **Status:** Implementado
> **Depends on:** SPEC 02 (`mdToBlocks`, `blocks.ts` — `B_LIST`/`takeList` como base análoga)
> **Date:** 2026-07-30
> **Objective:** Agregar reconocimiento de listas numeradas de markdown (`1.  texto`) como bloques `numbered_list_item` de Notion en `mdToBlocks`, cerrando el riesgo conocido documentado en SPEC 02 ahora que aparece un caso real validado (11 líneas en el módulo 1 de "Curso Profesional de JavaScript").

---

## Scope

**In:**

- `src/md-to-notion/blocks.ts`:
  - Nuevo regex `B_NUMBERED_LIST = /^(\s*)\d+\.\s+(.*)$/`, análogo a `B_LIST` pero para listas numeradas (`1.  texto`, con uno o más espacios después del punto, como emite pandoc).
  - Nueva función `takeNumberedList(lines, start)`, espejo estructural de `takeList`: mismo manejo de profundidad por indentación de a 4 espacios (`children` anidados), misma tolerancia a líneas en blanco entre ítems contiguos (no corta la lista si lo que sigue sigue siendo una lista numerada), mismo criterio de corte (para en la primera línea que no matchea `B_NUMBERED_LIST`, incluida una línea de viñeta — el corte de una lista numerada por una lista con viñeta inmediatamente después, sin línea en blanco, no está en el corpus real y no se trata como caso especial: cada función simplemente deja de consumir en la primera línea que no matchea su propio regex).
  - Nueva rama de despacho en `mdToBlocks`, al mismo nivel que la rama de `B_LIST`: si la línea matchea `B_NUMBERED_LIST` (y no matchea ya heading/imagen/fence), delega en `takeNumberedList`.
- `src/md-to-notion/types.ts`: nueva variante de `NotionBlock` para `numbered_list_item`, misma forma que `bulleted_list_item` (`{ rich_text: RichText[]; children?: NotionBlock[] }`) — Notion numera automáticamente por posición del bloque, no hace falta un campo `number` explícito.
- Tests en `src/md-to-notion/__tests__/blocks.test.ts`, mismo estilo que los ya existentes para `takeList`: lista numerada simple, lista numerada anidada a dos niveles (`children`), corte por línea en blanco seguida de más lista numerada (no corta) y seguida de párrafo (sí corta).
- Verificación puntual (no en CI) del módulo real: correr `npm run blocks -- workspace/curso-profesional-de-javascript/modules/01-introduccion.md` y contar, sobre el JSON resultante, cuántos bloques son `numbered_list_item` (`jq '[.blocks[] | select(.type=="numbered_list_item")] | length'` o equivalente) — se espera 11.
- Verificación manual real contra Notion: correr `npm run push` (sin `--dry-run`) para ese mismo módulo contra una página real, y confirmar visualmente que las 11 líneas se ven como lista numerada de Notion.
- Actualización de `README.md`:
  - Las dos menciones a `SPEC 04` que hoy se refieren al CLI de orquestación (líneas 13 y 76) pasan a decir `SPEC 05`.
  - Fila de la tabla de `src/md-to-notion/` para `blocks.ts` (línea 107) actualizada para mencionar `takeNumberedList`/`numbered_list_item`, igual que ya menciona `takeList`/`bulleted_list_item`.

**Out of scope (para specs futuras):**

- Bloque de cita real de Notion (`quote`) para líneas `> texto`. Sigue sin aparecer en el corpus real ya validado (0 casos verificados) — permanece como riesgo conocido documentado en SPEC 02, sin resolver acá.
- Encabezados H4-H6 como bloque heading de Notion. Mismo motivo: 0 casos verificados en el corpus real — permanece como riesgo conocido documentado en SPEC 02, sin resolver acá.
- Listas numeradas con estilo `1)` (paréntesis) en vez de `1.` (punto): no aparece en el corpus real; si aparece un caso, se arregla en una spec chica dedicada, mismo criterio que este mismo fix.
- Interleaving de lista numerada y lista con viñeta sin línea en blanco entre ambas (p. ej. una línea numerada seguida inmediatamente por una viñeta): no aparece en el corpus real; el comportamiento resultante (cada `take*List` corta al primer no-match) se considera aceptable sin caso de prueba dedicado.
- CLI de orquestación `.docx` → Notion end-to-end (SPEC 05, antes referida como SPEC 04).
- Registro de cursos / `course-registry.json` (SPEC 06, antes SPEC 05).
- Creación de filas de curso en la base `Cursos` (SPEC 07, fase 2, antes SPEC 06).
- Uso de `@notionhq/client` u otro SDK oficial de Notion.

---

## Data model

```ts
// src/md-to-notion/types.ts — se agrega esta variante a la unión NotionBlock existente

export type NotionBlock =
  | /* ...variantes existentes sin cambios... */
  | {
      object: "block";
      type: "numbered_list_item";
      numbered_list_item: { rich_text: RichText[]; children?: NotionBlock[] };
    };
```

Conventions:

- `numbered_list_item` es estructuralmente idéntico a `bulleted_list_item` (mismo shape `{ rich_text, children? }`) — la única diferencia es el `type` y la clave del objeto. Notion asigna el número de forma automática según la posición del bloque entre sus hermanos `numbered_list_item` contiguos; no se persiste ni se calcula ningún número acá.
- No se introduce un tipo compartido `ListItemBlock` ni se generaliza `bulleted_list_item`/`numbered_list_item` bajo una interfaz común: se mantiene la misma duplicación con la que ya conviven `bulleted_list_item` y el resto de variantes de la unión, siguiendo la decisión de arquitectura de "función espejo" (`takeNumberedList`) tomada para `blocks.ts`.

---

## Implementation plan

1. `src/md-to-notion/types.ts` + `src/md-to-notion/blocks.ts` + tests, en un solo paso (van atados: el tipo sin uso no sirve, y la implementación sin test no cumple el estándar del resto del archivo):
   - `types.ts`: agregar la variante `numbered_list_item` a la unión `NotionBlock` (mismo shape que `bulleted_list_item`).
   - `blocks.ts`: agregar el regex `B_NUMBERED_LIST`, la función `takeNumberedList` (copia estructural de `takeList` que devuelve bloques `numbered_list_item`) y la rama de despacho correspondiente en `mdToBlocks`, en el mismo lugar donde hoy se chequea `B_LIST`.
   - `__tests__/blocks.test.ts`: lista numerada simple (tres ítems), lista numerada anidada a dos niveles con `children`, línea en blanco que no corta la lista (sigue numerada después), línea en blanco que sí corta la lista (sigue un párrafo).
2. Verificación puntual (no en CI, porque el `.md` de origen es contenido de curso y no se commitea): correr `npm run blocks -- workspace/curso-profesional-de-javascript/modules/01-introduccion.md` y contar, sobre el JSON resultante, cuántos bloques son `numbered_list_item` — no una revisión visual del JSON, sino un conteo verificable (`jq '[.blocks[] | select(.type=="numbered_list_item")] | length'` o equivalente). Se espera que dé **11** (las 11 líneas numeradas ya verificadas por grep). El comando y el resultado quedan documentados en el acceptance criteria, igual que SPEC 02 documentó sus verificaciones manuales con números concretos.
3. `README.md`: actualizar las dos menciones a `SPEC 04` (líneas 13 y 76) a `SPEC 05`, y la fila de `blocks.ts` en la tabla de `src/md-to-notion/` para mencionar `takeNumberedList`/`numbered_list_item` junto a `takeList`/`bulleted_list_item`.

---

## Acceptance criteria

- [x] `npm run typecheck` y `npm test` pasan sin errores con los cambios en `src/md-to-notion/types.ts` y `src/md-to-notion/blocks.ts`. (213 tests pasan.)
- [x] Una lista numerada simple (`1. uno\n2. dos\n3. tres`) produce tres bloques `numbered_list_item`, uno por línea, en orden. (Test: `blocks.test.ts` → "lista numerada simple produce numbered_list_item por línea".)
- [x] Una lista numerada anidada a dos niveles produce un `numbered_list_item` con el hijo dentro de `children`, no un bloque plano. (Test: `blocks.test.ts` → "lista numerada anidada a dos niveles produce children dentro del item padre".)
- [x] Una línea en blanco entre ítems numerados no corta la lista si lo que sigue sigue siendo una línea numerada. (Test: `blocks.test.ts` → "una línea en blanco no corta la lista numerada si sigue habiendo números después".)
- [x] Una línea en blanco sí corta la lista numerada si lo que sigue no es una línea numerada (cae a párrafo). (Test: `blocks.test.ts` → "una línea en blanco sí corta la lista numerada si lo que sigue no es una línea numerada".)
- [x] Corriendo `npm run blocks -- workspace/curso-profesional-de-javascript/modules/01-introduccion.md`, el conteo de bloques `numbered_list_item` en el JSON resultante da 11. Verificado con `node src/cli/blocks.ts workspace/curso-profesional-de-javascript/modules/01-introduccion.md` + conteo programático de `type === "numbered_list_item"` sobre el JSON resultante (equivalente al `jq` propuesto; `jq` no estaba instalado en la máquina) → **resultado: 11**.
- [x] Corriendo `npm run push -- --modulo workspace/curso-profesional-de-javascript/modules/01-introduccion.md --media workspace/curso-profesional-de-javascript/media --parent <PARENT_PAGE_ID>` (sin `--dry-run`) contra una página real de Notion, la página resultante muestra las 11 líneas como lista numerada real (1, 2, 3…), no como párrafo con el número como texto literal. Verificado contra `parent = 3ab0083c97d1819aa425e1f4003aac8a`: https://app.notion.com/p/1-Introducci-n-3ad0083c97d1815e83b9eafc38958b4f — confirmado visualmente por el usuario.
- [x] `README.md`: las dos menciones a `SPEC 04` que se refieren al CLI de orquestación (líneas 13 y 76) dicen `SPEC 05`; la fila de `blocks.ts` en la tabla de `src/md-to-notion/` menciona `takeNumberedList`/`numbered_list_item`.

---

## Decisions

- **Sí:** regex `B_NUMBERED_LIST` solo para el estilo `1.` (dígitos + punto + espacios), igual a lo que emite pandoc en el corpus real validado. **No:** soporte para el estilo `1)` (paréntesis) — no aparece en ningún `.docx` real, se agrega si aparece un caso, en spec dedicada.
- **Sí:** implementar `takeNumberedList` como función espejo de `takeList` (duplicación estructural, no generalización paramétrica). Mantiene cada función simple y diffable por separado, y responde directamente al pedido original ("análogo a como B_LIST/takeList arman bulleted_list_item hoy"). Se reconsideró generalizar con un parámetro de tipo de bloque y se descartó: hoy ninguna otra parte de `blocks.ts` usa ese tipo de abstracción, y el archivo ya es diffable 1:1 contra el prototipo en el resto de sus funciones.
- **Sí:** soportar anidación por indentación (`children`) en `takeNumberedList` desde el arranque, aunque el corpus real validado no tenga ningún caso de lista numerada anidada. Copiar la lógica de profundidad de `takeList` no agrega código nuevo real (es la misma estructura) y evita dejar otro "riesgo conocido" documentado a mitad de un fix que ya está cerrando riesgos conocidos de SPEC 02.
- **No:** tipo compartido (`ListItemBlock` o similar) entre `bulleted_list_item` y `numbered_list_item` en `types.ts`. Se mantiene la misma duplicación de shape con la que ya conviven el resto de las variantes de la unión `NotionBlock`.
- **Sí:** verificación puntual del módulo real mediante conteo programático (`jq` sobre el JSON de `npm run blocks`), no revisión visual línea por línea del JSON — el JSON de bloques no es un formato pensado para revisión humana ojo por ojo; un conteo verificable (11 `numbered_list_item` esperados) es suficiente y es lo que de verdad se puede automatizar sin tocar CI (el `.md` de origen no se commitea).
- **Sí:** agregar como acceptance criterion un push real (sin `--dry-run`) del módulo 1 contra una página de Notion real, para confirmar visualmente que la lista se renderiza como lista numerada de Notion. Mismo criterio de validación manual que ya usó SPEC 03 contra la red real. Ejecutado a mano por el usuario (o por el asistente si se pide explícitamente) — no se dispara solo durante la implementación, porque toca un workspace de Notion real.
- **No:** resolver en esta spec los otros dos riesgos documentados junto a este en SPEC 02 (cita `>` como `quote`, headings H4-H6). Mismo motivo original: 0 casos verificados en el corpus real. Quedan como riesgo conocido para specs futuras dedicadas si aparece un caso real.
- **Sí:** actualizar en `README.md` las dos menciones a `SPEC 04` (CLI de orquestación) a `SPEC 05`, y usar en el texto de esta spec la numeración corrida hacia adelante (orquestación=05, registro=06, filas=07) para las referencias a specs futuras. **No** se tocan `specs/02-md-to-notion.md` ni `specs/03-notion-client.md` — quedan como registro histórico tal cual están, aunque sus menciones internas a esos números queden desactualizadas a propósito (mismo criterio ya establecido para specs en estado `Implementado`).

---

## Risks

| Risk                                                                                                                                                                                                                                                                                                                                                          | Mitigation                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| El estado reanudable (`.notion-sync-state.json`) puede tener ya marcado el módulo 1 como `done` bajo el mismo `parentId` usado en pruebas manuales previas de SPEC 03. Si es así, `npm run push` para el criterio de aceptación lo saltaría sin tocar la red (comportamiento correcto de SPEC 03), y la verificación visual en Notion no probaría nada nuevo. | Antes de correr el push de verificación, usar un `PARENT_PAGE_ID` nuevo (no reutilizado en pruebas previas), o borrar a mano la entrada del módulo 1 en `.notion-sync-state.json` del `outDir` correspondiente para forzar la recreación de la página. |

**Resultado real de esta verificación:** el riesgo se dio tal cual — el módulo 1 ya estaba `done` bajo el `parentId` usado. Al forzar la recreación (poniendo `done: false` con el `pageId` previo intacto), `pushModule` intentó archivar la página anterior vía `PATCH /pages/{id}` con `archived: true`, y la API de Notion lo rechazó (`400 validation_error: body.archived should be not present`) bajo el `NOTION_VERSION` pinneado (`2026-03-11`) — la API parece haber reemplazado ese campo (probablemente por `in_trash`). Es un bug real y preexistente en `pushModule` (`SPEC 03`), fuera de alcance de esta spec. Para desbloquear la verificación sin tocar código fuera de alcance, el usuario borró la página vieja a mano en Notion y se vació la entrada del módulo 1 en el estado, permitiendo que `pushModule` creara la página de cero sin pasar por el `PATCH` de archivado. **Queda pendiente una spec chica para arreglar el archivado de páginas a medias en `push-module.ts`.**

---

## What is **not** in this spec

- Bloque de cita real (`quote`) para líneas `> texto` — queda como riesgo conocido (otra spec, si aparece un caso real).
- Encabezados H4-H6 como bloque heading de Notion — queda como riesgo conocido (otra spec, si aparece un caso real).
- Listas numeradas con estilo `1)` (paréntesis) — otra spec, si aparece un caso real.
- CLI de orquestación `.docx` → Notion end-to-end (otra spec, SPEC 05).
- Registro de cursos / `course-registry.json` (otra spec, SPEC 06).
- Creación de filas de curso en la base `Cursos` (fase 2, SPEC 07).
- `@notionhq/client` u otro SDK oficial de Notion.

Cada uno de estos, si se implementa, va en su propia spec.
