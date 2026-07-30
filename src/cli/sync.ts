#!/usr/bin/env node
import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { convertDocx } from "../docx-to-md/convert.ts";
import { slugify } from "../docx-to-md/modules.ts";
import { loadEnv, notion } from "../notion-client/client.ts";
import { pushModule } from "../notion-client/push-module.ts";
import { loadState } from "../notion-client/state.ts";

export interface RunSyncOptions {
  docxPath: string;
  parentId: string;
  moduleNumber?: number; // MODULO_N parseado; ausente = todos los módulos
  dryRun: boolean;
  force: boolean; // solo válido junto con moduleNumber; se valida en runSync
}

interface NotionPage {
  properties?: Record<string, { type: string; title?: { plain_text: string }[] }>;
}

export function parseArgv(argv: string[]): RunSyncOptions | null {
  const positional: string[] = [];
  let dryRun = false;
  let force = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else positional.push(arg);
  }

  const [docxPath, parentId, moduleArg] = positional;
  if (!docxPath || !parentId) return null;

  return {
    docxPath,
    parentId,
    moduleNumber: moduleArg !== undefined ? Number(moduleArg) : undefined,
    dryRun,
    force,
  };
}

export async function runSync(options: RunSyncOptions): Promise<void> {
  const { docxPath, parentId, moduleNumber, dryRun, force } = options;

  if (force && moduleNumber === undefined) {
    throw new Error("--force requiere especificar MODULO_N (no se permite forzar el rehacer de una corrida completa)");
  }

  if (!existsSync(docxPath)) {
    throw new Error(`No existe ${docxPath}`);
  }

  const manifest = convertDocx({ docxPath });

  let modules = manifest.modules;
  if (moduleNumber !== undefined) {
    modules = modules.filter((mod) => mod.number === moduleNumber);
    if (!modules.length) {
      throw new Error(`No hay módulo ${moduleNumber}. Van del 1 al ${manifest.modules.length}.`);
    }
  }

  const slug = slugify(basename(docxPath, extname(docxPath)));
  const outDir = resolve("workspace", slug);
  const mediaDir = join(outDir, "media");

  if (!dryRun) {
    try {
      const parent = await notion<NotionPage>("GET", `/pages/${parentId.replace(/-/g, "")}`);
      const titleProp = parent.properties && Object.values(parent.properties).find((p) => p.type === "title");
      const nombre = titleProp?.title?.[0]?.plain_text ?? "(sin título)";
      console.log(`Padre: ${nombre}`);
    } catch (err) {
      console.error("\nNo pude leer la página padre. Revisa que:");
      console.error("  - NOTION_TOKEN sea el de la integración (no el de tu sesión)");
      console.error("  - la fila del curso esté compartida con esa integración");
      console.error("  - el id sea el de la fila abierta como página, sin el ?v=…\n");
      throw err;
    }
  }

  const state = loadState(outDir);
  console.log(`Subiendo ${modules.length} módulo(s)${dryRun ? " (simulación)" : ""}`);
  for (const mod of modules) {
    await pushModule(mod, join(outDir, mod.file), mediaDir, parentId, outDir, state, dryRun, force);
  }
  console.log("Listo.");
}

async function main(): Promise<void> {
  loadEnv();
  const options = parseArgv(process.argv.slice(2));
  if (!options) {
    console.error("Uso: npm run sync -- <archivo.docx> <PARENT_PAGE_ID> [MODULO_N] [--dry-run] [--force]");
    process.exitCode = 1;
    return;
  }

  try {
    await runSync(options);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${resolve(process.argv[1] ?? "")}`) {
  main();
}
