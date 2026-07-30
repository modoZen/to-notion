#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import type { Manifest } from "../docx-to-md/types.ts";
import { loadEnv } from "../notion-client/client.ts";
import { pushModule } from "../notion-client/push-module.ts";
import { loadState } from "../notion-client/state.ts";
import type { PushModuleInput } from "../notion-client/types.ts";

interface Flags {
  modulo?: string;
  media?: string;
  parent?: string;
  dryRun: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--modulo") flags.modulo = argv[++i];
    else if (arg === "--media") flags.media = argv[++i];
    else if (arg === "--parent") flags.parent = argv[++i];
    else if (arg === "--dry-run") flags.dryRun = true;
  }
  return flags;
}

/**
 * Prefiere el título tal cual quedó en manifest.json (buscando por número);
 * si no hay manifest o no aparece ese número, lo reconstruye del nombre de
 * archivo NN-titulo-slug.md — degradado (sin acentos/mayúsculas), pero es el
 * único dato disponible cuando el .md se movió o el manifest no existe.
 */
function resolvePushModuleInput(mdPath: string, outDir: string): PushModuleInput {
  const name = basename(mdPath, extname(mdPath));
  const m = /^(\d+)-(.+)$/.exec(name);
  if (!m) throw new Error(`No se pudo interpretar el número de módulo desde "${name}"`);
  const number = Number(m[1]);
  const fallbackTitle = m[2].replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

  const manifestPath = resolve(outDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    const entry = manifest.modules.find((mod) => mod.number === number);
    if (entry) return { number: entry.number, title: entry.title };
  }
  return { number, title: fallbackTitle };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (!flags.modulo || !flags.media || !flags.parent) {
    console.error("Uso: npm run push -- --modulo <ruta.md> --media <mediaDir> --parent <PARENT_PAGE_ID> [--dry-run]");
    process.exitCode = 1;
    return;
  }

  loadEnv();

  const mdPath = resolve(flags.modulo);
  const mediaDir = resolve(flags.media);
  const outDir = dirname(mediaDir);

  try {
    const mod = resolvePushModuleInput(mdPath, outDir);
    const state = loadState(outDir);
    await pushModule(mod, mdPath, mediaDir, flags.parent, outDir, state, flags.dryRun);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
