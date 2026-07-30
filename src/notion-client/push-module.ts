import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { notion } from "./client.ts";
import { uploadImage, resolveImages } from "./images.ts";
import { saveState } from "./state.ts";
import { batch, mdToBlocks } from "../md-to-notion/blocks.ts";
import type { ParentState, PushModuleInput, SyncState } from "./types.ts";

type Position = { type: "page_start" } | { type: "after_block"; after_block: { id: string } };

/**
 * El pageId guardado puede ya no estar entre los hijos actuales del padre
 * (la página se borró a mano en Notion, como pasó con el módulo 1 en SPEC 05).
 * En ese caso se camina hacia atrás por los módulos anteriores trackeados en el
 * estado buscando el primero que sí siga presente, para reconstruir la posición
 * intencionada en vez de caer directo al final.
 */
function computePosition(children: string[], oldPageId: string, moduleNumber: number, bucket: ParentState): Position {
  const idx = children.indexOf(oldPageId);
  if (idx !== -1) {
    return idx === 0 ? { type: "page_start" } : { type: "after_block", after_block: { id: children[idx - 1] } };
  }
  for (let n = moduleNumber - 1; n >= 1; n--) {
    const candidateId = bucket.modules[String(n)]?.pageId;
    if (candidateId && children.includes(candidateId)) {
      return { type: "after_block", after_block: { id: candidateId } };
    }
  }
  return { type: "page_start" };
}

export async function pushModule(
  mod: PushModuleInput,
  mdPath: string,
  mediaDir: string,
  parentId: string,
  outDir: string,
  state: SyncState,
  dryRun: boolean,
  force: boolean,
): Promise<void> {
  const key = String(mod.number);
  const bucket = (state[parentId] ||= { modules: {} });
  const prev = bucket.modules[key];

  if (prev && prev.done && !force) {
    console.log(`  ${key}. ${mod.title} — ya estaba subido, se salta`);
    return;
  }

  const md = readFileSync(mdPath, "utf8");
  const { blocks, images } = mdToBlocks(md, { imageMode: "marker" });
  const title = `${key}. ${mod.title}`;

  console.log(`  ${title} — ${blocks.length} bloques, ${images.length} imágenes`);
  if (dryRun) return;

  // Una página a medias de un intento anterior (o un rehacer forzado) se archiva
  // y se rehace: es la única forma barata de no dejar duplicados ni bloques
  // repetidos. La posición se calcula antes de archivar, contra los hijos
  // actuales del padre: un bloque ya trasheado no está documentado como ancla
  // válida para after_block.
  let position: Position | undefined;
  if (prev && prev.pageId) {
    const { results } = await notion<{ results: { id: string }[] }>("GET", `/blocks/${parentId}/children`);
    position = computePosition(
      results.map((r) => r.id),
      prev.pageId,
      mod.number,
      bucket,
    );

    console.log("    intento anterior incompleto, archivando esa página");
    try {
      await notion("PATCH", `/pages/${prev.pageId}`, { in_trash: true });
    } catch (err) {
      console.log(`    no se pudo archivar la página vieja (¿ya no existe?): ${err instanceof Error ? err.message : err}`);
    }
  }

  const idByToken: Record<string, string> = {};
  for (const token of images) {
    const file = join(mediaDir, token);
    if (!existsSync(file)) {
      console.log(`    falta ${token}, se deja el marcador`);
      continue;
    }
    idByToken[token] = await uploadImage(file);
  }
  if (images.length) console.log(`    ${Object.keys(idByToken).length}/${images.length} imágenes subidas`);

  const finalBlocks = resolveImages(blocks, idByToken);
  const lotes = batch(finalBlocks);

  const page = await notion<{ id: string; url?: string }>("POST", "/pages", {
    parent: { page_id: parentId },
    properties: { title: [{ type: "text", text: { content: title } }] },
    children: lotes[0] || [],
    ...(position ? { position } : {}),
  });
  bucket.modules[key] = { pageId: page.id, done: false };
  saveState(outDir, state);

  for (let i = 1; i < lotes.length; i++) {
    await notion("PATCH", `/blocks/${page.id}/children`, { children: lotes[i] });
    console.log(`    lote ${i + 1}/${lotes.length}`);
  }

  bucket.modules[key].done = true;
  saveState(outDir, state);
  console.log(`    listo: ${page.url || page.id}`);
}
