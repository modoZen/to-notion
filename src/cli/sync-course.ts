#!/usr/bin/env node
import { existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { convertDocx } from "../docx-to-md/convert.ts";
import { courseFolderName, courseSlug } from "../docx-to-md/modules.ts";
import { createCourse, updateCourseAfterSync } from "../notion-client/course.ts";
import { hashFile } from "../notion-client/hash.ts";
import { loadEnv } from "../notion-client/client.ts";
import { loadRegistry, saveRegistry, upsertCourse } from "../notion-client/registry.ts";
import type { CourseProperties } from "../notion-client/types.ts";
import { runSync } from "./sync.ts";

export interface RunSyncCourseOptions {
  docxPath: string;
  moduleNumber?: number; // MODULO_N parseado; ausente = todos los módulos
  dryRun: boolean;
  force: boolean;
  area?: string; // requerido si el slug es nuevo (se valida en runSyncCourse)
  plataforma?: string; // ídem
  estado?: string; // default "Terminado" si falta, aplicado en runSyncCourse
  titulo?: string; // si falta, se genera con prettifyTitle(basename)
}

export function prettifyTitle(basename: string): string {
  return basename
    .replace(/[-_]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

// Basenames de .docx que no aportan información al título por sí solos
// (comparación normalizada: NFD sin diacríticos, lowercase).
const GENERIC_BASENAMES = new Set(["clase", "clases"]);

function isGenericBasename(rawBasename: string): boolean {
  const normalized = rawBasename
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return GENERIC_BASENAMES.has(normalized);
}

export function parseArgv(argv: string[]): RunSyncCourseOptions | null {
  const positional: string[] = [];
  let dryRun = false;
  let force = false;
  let area: string | undefined;
  let plataforma: string | undefined;
  let estado: string | undefined;
  let titulo: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else if (arg === "--area") area = argv[++i];
    else if (arg === "--plataforma") plataforma = argv[++i];
    else if (arg === "--estado") estado = argv[++i];
    else if (arg === "--titulo") titulo = argv[++i];
    else positional.push(arg);
  }

  const [docxPath, moduleArg] = positional;
  if (!docxPath) return null;

  return {
    docxPath,
    moduleNumber: moduleArg !== undefined ? Number(moduleArg) : undefined,
    dryRun,
    force,
    area,
    plataforma,
    estado,
    titulo,
  };
}

export async function runSyncCourse(options: RunSyncCourseOptions): Promise<void> {
  const { docxPath, moduleNumber, dryRun, force } = options;

  if (!existsSync(docxPath)) {
    throw new Error(`No existe ${docxPath}`);
  }

  const slug = courseSlug(docxPath);
  const docxFileName = `${courseFolderName(docxPath)}/${basename(docxPath)}`;
  const docxHash = hashFile(docxPath);
  const registry = loadRegistry();
  const existing = registry[slug];

  if (existing) {
    const parentId = existing.pageId;

    await runSync({ docxPath, parentId, moduleNumber, dryRun, force });

    if (!dryRun) {
      const manifest = convertDocx({ docxPath });
      upsertCourse(registry, slug, { pageId: parentId, docxFileName, docxHash });
      saveRegistry("workspace", registry);
      await updateCourseAfterSync(parentId, manifest.modules.length);
    }
    return;
  }

  if (!options.area || !options.plataforma) {
    throw new Error(
      "Curso nuevo (slug no registrado): --area y --plataforma son obligatorios " +
        "(npm run sync-course -- <docx> --area <area> --plataforma <plataforma>)",
    );
  }

  const databaseId = process.env.NOTION_CURSOS_DATABASE_ID;
  if (!databaseId) {
    throw new Error("Falta NOTION_CURSOS_DATABASE_ID (ponlo en .env o en el entorno)");
  }

  const manifest = convertDocx({ docxPath });
  const rawBasename = basename(docxPath, extname(docxPath));
  const titleSource = isGenericBasename(rawBasename) ? courseFolderName(docxPath) : rawBasename;
  const titulo = options.titulo ?? prettifyTitle(titleSource);
  const properties: CourseProperties = {
    titulo,
    area: options.area,
    plataforma: options.plataforma,
    estado: options.estado ?? "Terminado",
    modulos: manifest.modules.length,
    archivoOrigen: docxFileName,
    ultimaSincronizacion: new Date().toISOString(),
  };

  if (dryRun) {
    console.log("Curso nuevo (dry-run) — no se crea nada:");
    console.log(properties);
    console.log(`docxHash: ${docxHash}`);
    return;
  }

  const parentId = await createCourse(databaseId, properties);
  upsertCourse(registry, slug, { pageId: parentId, docxFileName, docxHash });
  saveRegistry("workspace", registry);

  await runSync({ docxPath, parentId, moduleNumber, dryRun: false, force });

  const freshManifest = convertDocx({ docxPath });
  await updateCourseAfterSync(parentId, freshManifest.modules.length);
}

async function main(): Promise<void> {
  loadEnv();
  const options = parseArgv(process.argv.slice(2));
  if (!options) {
    console.error(
      "Uso: npm run sync-course -- <archivo.docx> [MODULO_N] --area <area> --plataforma <plataforma> " +
        "[--estado <estado>] [--titulo <titulo>] [--dry-run] [--force]",
    );
    process.exitCode = 1;
    return;
  }

  try {
    await runSyncCourse(options);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${resolve(process.argv[1] ?? "")}`) {
  main();
}
