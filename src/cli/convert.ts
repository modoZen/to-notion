#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { convertDocx } from "../docx-to-md/convert.ts";
import { slugify } from "../docx-to-md/modules.ts";

function main(): void {
  const [docxPath] = process.argv.slice(2);
  if (!docxPath) {
    console.error("Uso: npm run convert -- <ruta.docx>");
    process.exitCode = 1;
    return;
  }

  try {
    convertDocx({ docxPath });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const slug = slugify(basename(docxPath, extname(docxPath)));
  const outDir = resolve("workspace", slug);
  const report = readFileSync(join(outDir, "report.txt"), "utf8").trimEnd();
  console.log(report);
  console.log(`\nsalida: ${outDir}`);
}

main();
