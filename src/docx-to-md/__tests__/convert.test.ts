import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../types.ts";

let mockRawMd = "";

vi.mock("../pandoc.ts", () => ({
  runPandoc: vi.fn((_docxPath: string, workDir: string) => {
    mkdirSync(workDir, { recursive: true });
    mkdirSync(join(workDir, "media"), { recursive: true });
    // El .docx de prueba "trae" una imagen extraída, como haría pandoc real.
    writeFileSync(join(workDir, "media", "image1.png"), "contenido-falso-de-imagen");
    const rawPath = join(workDir, "raw.md");
    writeFileSync(rawPath, mockRawMd, "utf8");
    return rawPath;
  }),
}));

const { convertDocx } = await import("../convert.ts");
const { runPandoc } = await import("../pandoc.ts");

const RAW_MD_CON_INDICE = `# Contenido

[Módulo 1](#modulo-1)

[Módulo 2](#modulo-2)

[Módulo 3](#modulo-3)

# Introducción a JavaScript

Un párrafo de prosa cualquiera que explica el módulo con varias palabras conectoras.

const x = 1;

![](./media/image1.png)
`;

const RAW_MD_DOS_MODULOS = `# Modulo A

Contenido de A.

# Modulo B

Contenido de B.
`;

describe("convertDocx", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "docx2md-workspace-"));
    vi.mocked(runPandoc).mockClear();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("convierte, descarta el índice por defecto, copia medios y escribe todos los archivos de salida", () => {
    mockRawMd = RAW_MD_CON_INDICE;
    const manifest = convertDocx({ docxPath: "curso-de-prueba.docx", workspaceRoot });

    expect(runPandoc).toHaveBeenCalledTimes(1);

    const outDir = join(workspaceRoot, "curso-de-prueba");
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(outDir, "report.txt"))).toBe(true);
    expect(existsSync(join(outDir, "media", "image1.png"))).toBe(true);
    expect(existsSync(join(outDir, "modules", "01-introduccion-a-javascript.md"))).toBe(true);

    expect(manifest.source).toBe("curso-de-prueba.docx");
    expect(manifest.modules).toHaveLength(1);
    expect(manifest.modules[0]).toMatchObject({
      number: 1,
      title: "Introducción a JavaScript",
      file: "modules/01-introduccion-a-javascript.md",
      images: ["image1.png"],
      stats: { code: 1, images: 1, headings: 0, lists: 0, paras: 1, quotes: 0 },
    });

    const moduleFile = readFileSync(join(outDir, "modules", "01-introduccion-a-javascript.md"), "utf8");
    expect(moduleFile).toContain("# Introducción a JavaScript");
    expect(moduleFile).toContain("```javascript\nconst x = 1;\n```");
    expect(moduleFile).toContain("![](image1.png)");

    const manifestOnDisk = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as Manifest;
    expect(manifestOnDisk).toEqual(manifest);
  });

  it("con keepIndex: true conserva el módulo de índice", () => {
    mockRawMd = RAW_MD_CON_INDICE;
    const manifest = convertDocx({
      docxPath: "curso-de-prueba.docx",
      workspaceRoot,
      keepIndex: true,
    });

    expect(manifest.modules).toHaveLength(2);
    expect(manifest.modules[0].title).toBe("Contenido");
    expect(manifest.modules[1].title).toBe("Introducción a JavaScript");
  });

  it("reusa el caché si manifest.json ya existe: no vuelve a invocar pandoc", () => {
    mockRawMd = RAW_MD_DOS_MODULOS;
    const primero = convertDocx({ docxPath: "curso-de-prueba.docx", workspaceRoot });
    expect(runPandoc).toHaveBeenCalledTimes(1);

    const segundo = convertDocx({ docxPath: "curso-de-prueba.docx", workspaceRoot });
    expect(runPandoc).toHaveBeenCalledTimes(1); // no un segundo llamado
    expect(segundo).toEqual(primero);
  });

  it("con el filtro 'only' activo, genera solo el módulo indicado", () => {
    mockRawMd = RAW_MD_DOS_MODULOS;
    const manifest = convertDocx({ docxPath: "curso-de-prueba.docx", workspaceRoot, only: 2 });

    const outDir = join(workspaceRoot, "curso-de-prueba");
    expect(existsSync(join(outDir, "modules", "01-modulo-a.md"))).toBe(false);
    expect(existsSync(join(outDir, "modules", "02-modulo-b.md"))).toBe(true);
    expect(manifest.modules).toHaveLength(1);
    expect(manifest.modules[0]).toMatchObject({ number: 2, title: "Modulo B" });
  });
});
