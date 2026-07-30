import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../docx-to-md/types.ts";

const { convertDocxMock, loadEnvMock, notionMock, loadStateMock, pushModuleMock } = vi.hoisted(() => ({
  convertDocxMock: vi.fn(),
  loadEnvMock: vi.fn(),
  notionMock: vi.fn(),
  loadStateMock: vi.fn(),
  pushModuleMock: vi.fn(),
}));

vi.mock("../../docx-to-md/convert.ts", () => ({ convertDocx: convertDocxMock }));
vi.mock("../../notion-client/client.ts", () => ({ loadEnv: loadEnvMock, notion: notionMock }));
vi.mock("../../notion-client/state.ts", () => ({ loadState: loadStateMock }));
vi.mock("../../notion-client/push-module.ts", () => ({ pushModule: pushModuleMock }));

const { parseArgv, runSync } = await import("../sync.ts");

const manifest: Manifest = {
  source: "curso.docx",
  generated: "2026-01-01T00:00:00.000Z",
  modules: [
    { number: 1, title: "Uno", file: "modules/01-uno.md", images: [], stats: { code: 0, images: 0, headings: 1, lists: 0, paras: 1, quotes: 0 } },
    { number: 2, title: "Dos", file: "modules/02-dos.md", images: [], stats: { code: 0, images: 0, headings: 1, lists: 0, paras: 1, quotes: 0 } },
    { number: 3, title: "Tres", file: "modules/03-tres.md", images: [], stats: { code: 0, images: 0, headings: 1, lists: 0, paras: 1, quotes: 0 } },
  ],
};

describe("parseArgv()", () => {
  it("devuelve null si falta el .docx", () => {
    expect(parseArgv(["--dry-run", "parent-1"])).toBeNull();
  });

  it("devuelve null si falta el PARENT_PAGE_ID", () => {
    expect(parseArgv(["curso.docx"])).toBeNull();
  });

  it("reconoce MODULO_N y --dry-run en cualquier posición", () => {
    expect(parseArgv(["--dry-run", "curso.docx", "parent-1", "3"])).toEqual({
      docxPath: "curso.docx",
      parentId: "parent-1",
      moduleNumber: 3,
      dryRun: true,
    });
    expect(parseArgv(["curso.docx", "parent-1", "3", "--dry-run"])).toEqual({
      docxPath: "curso.docx",
      parentId: "parent-1",
      moduleNumber: 3,
      dryRun: true,
    });
  });

  it("sin MODULO_N ni --dry-run devuelve moduleNumber undefined y dryRun false", () => {
    expect(parseArgv(["curso.docx", "parent-1"])).toEqual({
      docxPath: "curso.docx",
      parentId: "parent-1",
      moduleNumber: undefined,
      dryRun: false,
    });
  });
});

describe("runSync()", () => {
  let dir: string;
  let docxPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sync-cli-"));
    docxPath = join(dir, "curso.docx");
    writeFileSync(docxPath, "");
    convertDocxMock.mockReset().mockReturnValue(manifest);
    loadEnvMock.mockReset();
    notionMock.mockReset();
    loadStateMock.mockReset().mockReturnValue({});
    pushModuleMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lanza un error claro si el .docx no existe en disco, antes de invocar convertDocx", async () => {
    const noExiste = join(dir, "no-existe.docx");
    await expect(runSync({ docxPath: noExiste, parentId: "parent-1", dryRun: true })).rejects.toThrow(
      `No existe ${noExiste}`,
    );
    expect(convertDocxMock).not.toHaveBeenCalled();
  });

  it("con MODULO_N válido filtra a un solo módulo y llama pushModule una sola vez", async () => {
    await runSync({ docxPath, parentId: "parent-1", moduleNumber: 2, dryRun: true });

    expect(pushModuleMock).toHaveBeenCalledTimes(1);
    expect(pushModuleMock.mock.calls[0][0]).toEqual(expect.objectContaining({ number: 2, title: "Dos" }));
  });

  it("con MODULO_N inválido produce el mensaje exacto y no llama a notion ni a pushModule", async () => {
    await expect(runSync({ docxPath, parentId: "parent-1", moduleNumber: 99, dryRun: false })).rejects.toThrow(
      "No hay módulo 99. Van del 1 al 3.",
    );
    expect(notionMock).not.toHaveBeenCalled();
    expect(pushModuleMock).not.toHaveBeenCalled();
  });

  it("con --dry-run salta el chequeo de padre pero llama a pushModule con dryRun: true para cada módulo", async () => {
    await runSync({ docxPath, parentId: "parent-1", dryRun: true });

    expect(notionMock).not.toHaveBeenCalled();
    expect(pushModuleMock).toHaveBeenCalledTimes(3);
    for (const call of pushModuleMock.mock.calls) {
      expect(call[6]).toBe(true);
    }
  });

  it("chequeo de padre exitoso imprime el nombre y continúa al loop de pushModule", async () => {
    notionMock.mockResolvedValueOnce({
      properties: { Name: { type: "title", title: [{ plain_text: "Mi Curso" }] } },
    });

    await runSync({ docxPath, parentId: "abc-def-123", dryRun: false });

    expect(notionMock).toHaveBeenCalledWith("GET", "/pages/abcdef123");
    expect(pushModuleMock).toHaveBeenCalledTimes(3);
    const notionOrder = notionMock.mock.invocationCallOrder[0];
    const firstPushOrder = pushModuleMock.mock.invocationCallOrder[0];
    expect(notionOrder).toBeLessThan(firstPushOrder);
  });

  it("chequeo de padre fallido aborta antes de cualquier pushModule", async () => {
    notionMock.mockRejectedValueOnce(new Error("GET /pages/parent-1 -> 403: forbidden"));

    await expect(runSync({ docxPath, parentId: "parent-1", dryRun: false })).rejects.toThrow("403");
    expect(pushModuleMock).not.toHaveBeenCalled();
  });

  it("un error de pushModule en el módulo intermedio aborta sin llamar a los módulos siguientes", async () => {
    pushModuleMock.mockReset();
    pushModuleMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("falló el módulo 2"));

    await expect(runSync({ docxPath, parentId: "parent-1", dryRun: true })).rejects.toThrow("falló el módulo 2");
    expect(pushModuleMock).toHaveBeenCalledTimes(2);
  });
});
