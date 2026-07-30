#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mdToBlocks } from "../md-to-notion/blocks.ts";

function main(): void {
  const [mdPath] = process.argv.slice(2);
  if (!mdPath) {
    console.error("Uso: npm run blocks -- <ruta/al/modulo.md>");
    process.exitCode = 1;
    return;
  }

  const markdown = readFileSync(mdPath, "utf8");
  const result = mdToBlocks(markdown);
  console.log(JSON.stringify(result, null, 2));
}

main();
