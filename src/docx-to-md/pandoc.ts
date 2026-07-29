import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// ===========================================================================
// 1. PANDOC: .docx -> markdown crudo
// ===========================================================================

export function runPandoc(docxPath: string, workDir: string): string {
  mkdirSync(workDir, { recursive: true });
  const rawPath = join(workDir, "raw.md");
  const res = spawnSync(
    "pandoc",
    [
      docxPath,
      "-t",
      "markdown",
      "--wrap=none", // DEFECTO 6: sin esto corta a ~72 cols y parte código
      `--extract-media=${workDir}`,
      "-o",
      rawPath,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 512 },
  );

  if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(
      "pandoc no está instalado o no se encuentra en el PATH. " +
        "Instalá pandoc (https://pandoc.org/installing.html) e intentá de nuevo.",
    );
  }
  if (res.status !== 0) {
    throw new Error(`pandoc falló (${res.status}): ${res.stderr}`);
  }
  return rawPath;
}
