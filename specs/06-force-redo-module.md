# SPEC 06 — Rehacer un módulo con --force: fix de archivado (in_trash) y reposicionamiento

> **Status:** Implementado
> **Depends on:** SPEC 03 (`pushModule`, `notion`, estado reanudable `.notion-sync-state.json`), SPEC 05 (`sync.ts`, `push.ts`)
> **Date:** 2026-07-30
> **Objective:** Arreglar el archivado roto de páginas a medias en `pushModule` (la API de Notion ya no acepta `archived`, ahora es `in_trash`) y agregar un flag `--force` en `push`/`sync` para rehacer explícitamente un módulo ya subido — reposicionando la página nueva en el lugar exacto donde estaba la vieja dentro de la lista de subpáginas del padre, en vez de al final.

---

## Scope

**In:**

- Arreglar el archivado en `pushModule` (`src/notion-client/push-module.ts`): reemplazar `{ archived: true }` por `{ in_trash: true }` en el `PATCH /pages/{id}` que ya existe para archivar un intento previo incompleto.
- Nuevo parámetro `force: boolean` en `pushModule(...)`. Hoy, si `prev.done === true`, la función saltea sin más (`"— ya estaba subido, se salta"`). Con `force: true`, en cambio, **no** saltea: entra al mismo camino de archivar-la-vieja-y-crear-la-nueva que ya existe para el caso de intento a medias.
- Reposicionamiento de la página nueva en el lugar de la vieja:
  1. Antes de archivar, `GET /blocks/{parentId}/children` (una sola página, sin paginar) para ubicar el `pageId` guardado en el estado entre los hijos actuales del padre.
  2. Si aparece: el ancla es el bloque **anterior** a él en esa lista (`position: { type: "after_block", after_block: { id } }`). Si es el primero (índice 0), el ancla es `position: { type: "page_start" }`.
  3. Si el `pageId` guardado **no** aparece entre los hijos actuales (la página ya no existe, como pasó con el módulo 1 en la verificación de SPEC 05): caminar hacia atrás por los módulos anteriores ya trackeados en el estado (N-1, N-2, … hasta 1), buscando el primero cuyo `pageId` sí siga entre los hijos actuales, y anclar ahí. Si ninguno aparece, `position: { type: "page_start" }`.
  4. Ese `position` calculado se pasa al `POST /pages` que crea la página nueva.
- Tolerancia a fallo en el archivado: si el `PATCH .../in_trash: true` de la página vieja falla (ya no existe), no aborta la corrida — loguea y sigue igual con la creación de la página nueva, usando el `position` ya calculado en el paso anterior (que no depende de si el archivado tuvo éxito).
- Flag `--force` nuevo en `push.ts` y `sync.ts`, threadeado hasta `pushModule`.
  - En `sync.ts`: `--force` sin `MODULO_N` es error de uso (mensaje claro + `exit 1`) — no se permite forzar el rehacer de una corrida completa.
- Tests nuevos/extendidos en `src/notion-client/__tests__/push-module.test.ts` cubriendo: `in_trash` en vez de `archived`, `force: true` no saltea un módulo `done`, cálculo del ancla (hermano anterior encontrado / no encontrado con fallback por número de módulo / ninguno encontrado → `page_start`), y tolerancia al fallo de archivado.
- Tests extendidos en `src/cli/__tests__/sync.test.ts` para la validación de `--force` sin `MODULO_N`.
- `README.md`: documentar `--force` en los ejemplos de uso de `push` y `sync`.

**Out of scope (para specs futuras o explícitamente descartado):**

- Paginación de `GET /blocks/{parentId}/children` más allá de 100 hijos — se asume que entra en una sola página (cursos reales rondan ~30 módulos).
- Refactor de `push.ts` a `parseFlags`/`runPush` testeable — se agrega el flag `--force` sin tests nuevos ahí; la cobertura nueva vive en `push-module.test.ts`.
- Permitir `--force` sin `MODULO_N` en `sync.ts` para rehacer una corrida completa — descartado explícitamente.
- Auditoría más amplia de otros campos deprecados por la versión `2026-03-11` de la API más allá de `archived` → `in_trash` — solo se toca este caso puntual.
- `course-registry` / `course.create` (specs futuras, sin relación).

---

## Data model

No se introduce ninguna estructura persistida nueva — `SyncState`/`ModuleState`/`ParentState` (SPEC 03) quedan igual; `force` es un flag de runtime, no se guarda en `.notion-sync-state.json`.

Cambios de firma:

```ts
// src/notion-client/push-module.ts

export async function pushModule(
  mod: PushModuleInput,
  mdPath: string,
  mediaDir: string,
  parentId: string,
  outDir: string,
  state: SyncState,
  dryRun: boolean,
  force: boolean, // nuevo: si true, no saltea un módulo ya `done`
): Promise<void>;
```

```ts
// src/cli/sync.ts

export interface RunSyncOptions {
  docxPath: string;
  parentId: string;
  moduleNumber?: number;
  dryRun: boolean;
  force: boolean; // nuevo; parseArgv valida que solo venga junto con moduleNumber
}
```

```ts
// src/cli/push.ts

interface Flags {
  modulo?: string;
  media?: string;
  parent?: string;
  dryRun: boolean;
  force: boolean; // nuevo
}
```

El cálculo de la posición (`after_block` / `page_start`, y el recorrido hacia atrás por módulos anteriores cuando el `pageId` guardado ya no está entre los hijos del padre) vive como lógica interna, no exportada, dentro de `push-module.ts` — no se define un tipo compartido nuevo para esto; se arma el objeto `position` inline antes del `POST /pages`, igual de mínimo que el resto de las llamadas a `notion()` en el archivo. Se testea indirectamente a través de `pushModule` (inspeccionando el body del `POST /pages` mockeado), mismo criterio que ya usa `push-module.test.ts` hoy.

---

## Implementation plan

1. **Fix del archivado roto**: en `push-module.ts`, reemplazar `{ archived: true }` por `{ in_trash: true }` en el `PATCH /pages/{prev.pageId}` existente. Actualizar el test ya existente en `push-module.test.ts` ("archiva la página de un intento previo incompleto antes de rehacer") para esperar `in_trash: true`. Deja el sistema funcional: arregla el bug real de SPEC 04 de forma aislada, sin tocar nada más.

2. **Parámetro `force`**: agregar `force: boolean` a la firma de `pushModule`. Cambiar la condición de salteo de `if (prev && prev.done)` a `if (prev && prev.done && !force)`. Tests: un módulo `done` con `force: true` no saltea y entra al camino de archivar-y-recrear (reusando el mismo camino que ya existe para intentos a medias); sin `force`, comportamiento intacto.

3. **Reposicionamiento**: agregar la lógica de cálculo de `position` en `push-module.ts` — `GET /blocks/{parentId}/children`, ubicar el `pageId` guardado, tomar el hermano anterior como ancla o recorrer hacia atrás por módulos anteriores en el estado si no aparece, `page_start` si no hay ninguno. Pasar ese `position` al `POST /pages`. Hacer que el fallo del `PATCH .../in_trash` (página ya no existe) no aborte: loguea y sigue con la creación usando el `position` ya calculado. Tests: ancla = hermano directo; ancla = fallback por módulo anterior; sin ancla → `page_start`; archivado fallido no aborta y la página se crea igual.

4. **CLI**: agregar `--force` a `parseFlags` (`push.ts`) y a `parseArgv`/`RunSyncOptions` (`sync.ts`), threadeado hasta la llamada a `pushModule` en ambos. En `sync.ts`, `--force` sin `moduleNumber` es error de uso (`parseArgv` devuelve `null` o `runSync` lanza, a definir en la implementación) — sin tests nuevos en `push.ts` (decisión ya tomada), sí en `sync.test.ts` para la validación y el threading de `force`.

5. **`README.md`**: documentar `--force` en los ejemplos de uso de `npm run push` y `npm run sync`, mencionando que ahora permite rehacer un módulo puntual reposicionándolo en su lugar, y que el archivado usa `in_trash` (ya no `archived`).

6. **Verificación manual real** (no en CI, mismo criterio que specs anteriores): sobre el curso real ya usado en SPEC 05, forzar el rehacer de un módulo intermedio (ej. módulo 3, con 2 y 4 ya presentes) y confirmar visualmente que la página nueva queda en la posición 3, no al final. Repetir el escenario real que disparó esta spec: un módulo cuyo `pageId` en el estado ya no existe en Notion (como pasó con el módulo 1) y confirmar que ahora se resuelve solo (fallback a módulo anterior o `page_start`), sin necesitar editar el estado a mano. Este paso lo corre el usuario a mano, no el agente.

---

## Acceptance criteria

- [x] `npm run typecheck` y `npm test` pasan sin errores con los cambios en `push-module.ts`, `push.ts`, `sync.ts` y sus tests.
- [x] `pushModule` con `force: false` y módulo ya `done` saltea sin llamar a `notion` (sin regresión sobre el comportamiento actual). (Test.)
- [x] `pushModule` con `force: true` y módulo ya `done` **no** saltea: archiva la página vieja y crea una nueva. (Test.)
- [x] El archivado de la página vieja usa `in_trash: true` en el `PATCH /pages/{id}`, no `archived`. (Test.)
- [x] Si el `pageId` guardado del módulo aparece entre los hijos actuales del padre, el `POST /pages` de la página nueva incluye `position: { type: "after_block", after_block: { id: <hermano-anterior> } }`. (Test.)
- [x] Si el `pageId` guardado es el primer hijo (sin hermano anterior), el `POST /pages` incluye `position: { type: "page_start" }`. (Test.)
- [x] Si el `pageId` guardado no aparece entre los hijos actuales, `pushModule` recorre hacia atrás los módulos anteriores en el estado y ancla después del primero que sí aparece. (Test.)
- [x] Si ningún módulo anterior aparece entre los hijos actuales, el `POST /pages` incluye `position: { type: "page_start" }`. (Test.)
- [x] Si el `PATCH .../in_trash` de la página vieja falla (ya no existe), `pushModule` no aborta: loguea y crea la página nueva igual, con el `position` ya calculado. (Test.)
- [x] En `sync.ts`, `--force` sin `MODULO_N` produce un error de uso claro y no llama a `pushModule` ni a `notion`. (Test.)
- [x] En `sync.ts`, `--force` con `MODULO_N` válido llama a `pushModule` con `force: true` para ese módulo. (Test.)
- [x] En `push.ts`, el flag `--force` se parsea y se pasa a `pushModule` (sin test automatizado nuevo ahí — decisión ya tomada; cobertura queda en `push-module.test.ts`).
- [x] `npm run sync -- <docx-real> <PARENT_PAGE_ID> N --force` sobre un módulo intermedio (con vecinos presentes) deja la página nueva visualmente en su misma posición, no al final. (Verificado a mano.)
- [x] Repetir el escenario real que disparó esta spec — un módulo cuyo `pageId` en el estado ya no existe en Notion (como pasó con el módulo 1 en SPEC 05) — se resuelve solo, sin necesitar editar el estado a mano. (Verificado a mano.)
- [x] `README.md` documenta `--force` en los ejemplos de uso de `npm run push` y `npm run sync`.

---

## Decisions

- **Sí:** el fix del archivado (`archived` → `in_trash`), el flag `--force` y el reposicionamiento van en una sola spec — las tres cosas tocan el mismo bloque de código en `pushModule` (el que ya archiva-y-recrea para un intento a medias).
- **Sí:** `--force` es un flag separado, no un valor especial de `MODULO_N` — mantiene `MODULO_N` con un solo significado ("filtrar a este módulo") y hace el rehacer forzado más explícito/difícil de disparar sin querer.
- **Sí:** en `sync.ts`, `--force` sin `MODULO_N` es error de uso (`exit 1`) — forzar el rehacer de un curso completo es una operación demasiado grande para permitirla implícitamente.
- **Sí:** `push.ts` recibe `--force` sin refactor a `parseFlags`/`runPush` testeable y sin tests nuevos ahí — la cobertura de la lógica nueva vive en `push-module.test.ts`, que ya es testeable.
- **Sí:** el ancla para el reposicionamiento se calcula **antes** de archivar la página vieja, consultando `GET /blocks/{parentId}/children` una sola vez (sin paginar) y buscando el hermano anterior — en vez de confiar en que un bloque ya trasheado siga sirviendo como ancla para `after_block`, que no está documentado y no se quiso asumir.
- **Sí:** si no se encuentra el `pageId` guardado entre los hijos actuales, se camina hacia atrás por los módulos anteriores ya trackeados en el estado buscando el primero que sí aparezca, en vez de caer directo a `page_end` — reconstruye la posición intencionada aunque la página específica ya no exista (el escenario real que disparó esta spec).
- **Sí:** si el archivado de la página vieja falla (ya no existe), no aborta la corrida — loguea y sigue con la creación de la nueva, usando el `position` ya calculado.
- **No:** paginación de `GET /blocks/{parentId}/children` — los cursos reales rondan ~30 módulos, muy por debajo del límite de 100 por página.
- **No:** delegar el paso 6 (verificación manual real) al agente — queda corrido por el usuario, mismo criterio que todas las specs anteriores (control humano sobre mutaciones a contenido real de Notion).

---

## Risks

| Risk                                                                                                                                                                                                                                                                                        | Mitigation                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| El soporte de `position` en `POST /pages` para páginas hijas se confirmó contra la documentación oficial de Notion, pero no se probó todavía en vivo contra la API real — podría comportarse distinto de lo documentado.                                                                    | Si el comportamiento real difiere durante la verificación manual (paso 6), se ajusta el mecanismo de posicionamiento en ese mismo paso antes de cerrar la spec como Implementada. No bloquea el resto: el fix de `in_trash` y `--force` funcionan igual sin reposicionamiento si hiciera falta desactivarlo. |
| El recorrido hacia atrás por módulos anteriores puede no encontrar ningún ancla si varias páginas consecutivas desaparecieron de Notion (no solo la que se está rehaciendo) — cae a `page_start`, que puede no ser la posición "correcta" si el módulo rehecho no era el primero del curso. | Aceptado como degradado razonable — mejor que fallar. El usuario puede reordenar a mano en Notion si hace falta; no se agrega lógica más sofisticada (ej. insertar entre dos anclas usando el número de módulo) para mantener el alcance acotado.                                                            |
| Archivar (trashear) la página vieja pierde cualquier comentario o anotación que el usuario haya agregado a mano ahí — nada del contenido viejo se transplanta a la página nueva.                                                                                                            | Comportamiento heredado desde SPEC 03 (el archivado-y-recreación de un intento a medias ya tenía este efecto); esta spec no lo cambia, solo lo vuelve más frecuente al poder dispararse a propósito con `--force`. Vale que el usuario lo tenga presente antes de forzar un módulo con comentarios propios.  |
