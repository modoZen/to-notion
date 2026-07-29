import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runPandoc } from "../pandoc.ts";

const pandocAvailable = spawnSync("pandoc", ["--version"]).status === 0;

describe("runPandoc — pandoc no está en el PATH", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("lanza un mensaje de error claro (sin depender de si pandoc está instalado)", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawnSync: () => ({
        status: null,
        stderr: null,
        error: Object.assign(new Error("spawn pandoc ENOENT"), { code: "ENOENT" }),
      }),
    }));
    const { runPandoc: runPandocMocked } = await import("../pandoc.ts");
    expect(() => runPandocMocked("cualquier.docx", join(tmpdir(), "docx2md-test"))).toThrow(
      /pandoc no está instalado/,
    );
  });
});

describe("runPandoc — flags pasados a pandoc", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("invoca pandoc con --wrap=none (DEFECTO 6: sin esto corta a ~72 cols y parte código)", async () => {
    vi.resetModules();
    let receivedArgs: string[] = [];
    vi.doMock("node:child_process", () => ({
      spawnSync: (_cmd: string, args: string[]) => {
        receivedArgs = args;
        return { status: 0, stderr: "" };
      },
    }));
    const { runPandoc: runPandocMocked } = await import("../pandoc.ts");
    runPandocMocked("cualquier.docx", join(tmpdir(), "docx2md-flags-test"));
    expect(receivedArgs).toContain("--wrap=none");
  });
});

describe.skipIf(!pandocAvailable)("runPandoc — invocación real de pandoc", () => {
  let workDir: string;
  let docxPath: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "docx2md-work-"));
    docxPath = join(workDir, "fixture.docx");
    // Generamos un .docx mínimo con el propio pandoc (no se commitea: vive en
    // un directorio temporal y se genera en cada corrida de tests).
    const gen = spawnSync("pandoc", ["-f", "markdown", "-t", "docx", "-o", docxPath], {
      input: "# Titulo\n\nUn parrafo de prueba.\n",
      encoding: "utf8",
    });
    if (gen.status !== 0) throw new Error(`no se pudo generar el .docx de prueba: ${gen.stderr}`);
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("convierte el .docx y devuelve la ruta del markdown crudo generado", () => {
    const outDir = mkdtempSync(join(tmpdir(), "docx2md-out-"));
    const rawPath = runPandoc(docxPath, outDir);
    expect(existsSync(rawPath)).toBe(true);
    const raw = readFileSync(rawPath, "utf8");
    expect(raw).toContain("Titulo");
    expect(raw).toContain("Un parrafo de prueba.");
    rmSync(outDir, { recursive: true, force: true });
  });

  it("lanza un error claro si el .docx no existe", () => {
    const outDir = mkdtempSync(join(tmpdir(), "docx2md-out-"));
    expect(() => runPandoc(join(workDir, "no-existe.docx"), outDir)).toThrow(/pandoc falló/);
    rmSync(outDir, { recursive: true, force: true });
  });
});
