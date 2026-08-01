import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { classifyUnit, fuseSplitBlocks, resolveUnknowns } from "./classifier/units.ts";
import { courseSlug, removeIndexModule, slugify, splitModules } from "./modules.ts";
import { runPandoc } from "./pandoc.ts";
import { renderModule } from "./render.ts";
import { tokenize } from "./tokenizer.ts";
import type { ConvertOptions, Manifest } from "./types.ts";

// ===========================================================================
// 8. ORQUESTACIÓN — convertDocx
// ===========================================================================

export function convertDocx(options: ConvertOptions): Manifest {
  const workspaceRoot = options.workspaceRoot ?? "workspace";
  const slug = courseSlug(options.docxPath);
  const outDir = resolve(workspaceRoot, slug);
  const manifestPath = join(outDir, "manifest.json");

  // Reuso de caché: si ya se convirtió este .docx, no se vuelve a invocar
  // pandoc ni a reconvertir.
  if (existsSync(manifestPath)) {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  }

  const workDir = mkdtempSync(join(tmpdir(), "docx2md-"));
  const rawPath = runPandoc(resolve(options.docxPath), workDir);
  const rawMd = readFileSync(rawPath, "utf8");

  const units = tokenize(rawMd);
  let modules = splitModules(units);
  if (!options.keepIndex) modules = removeIndexModule(modules);

  const modulesDir = join(outDir, "modules");
  mkdirSync(modulesDir, { recursive: true });

  // Copiar los medios extraídos junto a la salida.
  const srcMedia = join(workDir, "media");
  const dstMedia = join(outDir, "media");
  if (existsSync(srcMedia)) {
    mkdirSync(dstMedia, { recursive: true });
    for (const f of readdirSync(srcMedia)) {
      copyFileSync(join(srcMedia, f), join(dstMedia, f));
    }
  }

  const manifest: Manifest = {
    source: basename(options.docxPath),
    generated: new Date().toISOString(),
    modules: [],
  };
  const report: string[] = [];

  modules.forEach((mod, idx) => {
    const number = idx + 1;
    if (options.only !== undefined && options.only !== number) return;

    let kinds = mod.units.map(classifyUnit);
    kinds = resolveUnknowns(kinds);
    kinds = fuseSplitBlocks(mod.units, kinds);

    const { text, stats } = renderModule(mod.units, kinds, mod.title);
    const file = `${String(number).padStart(2, "0")}-${slugify(mod.title)}.md`;
    const header = `# ${mod.title}\n\n`;
    writeFileSync(join(modulesDir, file), header + text, "utf8");

    const imgs = (text.match(/!\[\]\((image[^)]+)\)/g) || []).map((m) => m.slice(4, -1));
    manifest.modules.push({ number, title: mod.title, file: `modules/${file}`, images: imgs, stats });
    report.push(
      `${String(number).padStart(2, " ")}  ${file.padEnd(42)} ` +
        `código=${String(stats.code).padStart(3)}  imgs=${String(stats.images).padStart(3)}  ` +
        `H2=${String(stats.headings).padStart(2)}  párr=${String(stats.paras).padStart(3)}  listas=${String(stats.lists).padStart(3)}`,
    );
  });

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(join(outDir, "report.txt"), report.join("\n") + "\n", "utf8");

  return manifest;
}
