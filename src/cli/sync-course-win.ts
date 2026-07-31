#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { loadEnv } from "../notion-client/client.ts";
import { parseArgv, runSyncCourse } from "./sync-course.ts";

/**
 * Convierte una ruta de Windows (la que copia el Explorador con "Copiar
 * como ruta de acceso", con `\` y letra de unidad) a su equivalente WSL,
 * delegando en el `wslpath` real del sistema en vez de reimplementar la
 * traducción a mano (evita errores en casos raros: rutas UNC, mayúsculas
 * de unidad, etc.).
 */
export function toWslPath(winPath: string): string {
  return execFileSync("wslpath", ["-u", winPath], { encoding: "utf8" }).trim();
}

async function main(): Promise<void> {
  loadEnv();
  const [winPath, ...rest] = process.argv.slice(2);
  const usage =
    "Uso: npm run sync-course-win -- <ruta-windows-del-docx> [MODULO_N] --area <area> --plataforma <plataforma> [--estado <estado>] [--titulo <titulo>] [--dry-run] [--force]";

  if (!winPath) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  let docxPath: string;
  try {
    docxPath = toWslPath(winPath);
  } catch (err) {
    console.error(
      "No se pudo convertir la ruta con wslpath (¿estás corriendo dentro de WSL?):",
      err instanceof Error ? err.message : err,
    );
    process.exitCode = 1;
    return;
  }

  const options = parseArgv([docxPath, ...rest]);
  if (!options) {
    console.error(usage);
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
