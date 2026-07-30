import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { notion } from "./client.ts";
import { uploadImage, resolveImages } from "./images.ts";
import { saveState } from "./state.ts";
import { batch, mdToBlocks } from "../md-to-notion/blocks.ts";
import type { PushModuleInput, SyncState } from "./types.ts";

export async function pushModule(
  mod: PushModuleInput,
  mdPath: string,
  mediaDir: string,
  parentId: string,
  outDir: string,
  state: SyncState,
  dryRun: boolean,
): Promise<void> {
  const key = String(mod.number);
  const bucket = (state[parentId] ||= { modules: {} });
  const prev = bucket.modules[key];

  if (prev && prev.done) {
    console.log(`  ${key}. ${mod.title} — ya estaba subido, se salta`);
    return;
  }

  const md = readFileSync(mdPath, "utf8");
  const { blocks, images } = mdToBlocks(md, { imageMode: "marker" });
  const title = `${key}. ${mod.title}`;

  console.log(`  ${title} — ${blocks.length} bloques, ${images.length} imágenes`);
  if (dryRun) return;

  // Una página a medias de un intento anterior se archiva y se rehace: es la
  // única forma barata de no dejar duplicados ni bloques repetidos.
  if (prev && prev.pageId) {
    console.log("    intento anterior incompleto, archivando esa página");
    await notion("PATCH", `/pages/${prev.pageId}`, { in_trash: true });
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
