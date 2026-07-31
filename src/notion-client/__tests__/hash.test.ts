import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashFile } from "../hash.ts";

describe("hashFile()", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notion-client-hash-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("devuelve el sha256 hex conocido de un contenido fijo", () => {
    const file = join(dir, "a.txt");
    writeFileSync(file, "hola mundo");

    expect(hashFile(file)).toBe(
      "0b894166d3336435c800bea36ff21b29eaa801a52f584c006c49289a0dcf6e2f",
    );
  });

  it("dos llamadas al mismo archivo dan el mismo hash", () => {
    const file = join(dir, "b.txt");
    writeFileSync(file, "contenido estable");

    expect(hashFile(file)).toBe(hashFile(file));
  });

  it("archivos con contenido distinto dan hashes distintos", () => {
    const fileA = join(dir, "c.txt");
    const fileB = join(dir, "d.txt");
    writeFileSync(fileA, "contenido A");
    writeFileSync(fileB, "contenido B");

    expect(hashFile(fileA)).not.toBe(hashFile(fileB));
  });
});
