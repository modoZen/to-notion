import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../docx-to-md/types.ts";
import type { CourseRegistry } from "../../notion-client/types.ts";

const {
  runSyncMock,
  convertDocxMock,
  createCourseMock,
  updateCourseAfterSyncMock,
  hashFileMock,
  loadRegistryMock,
  saveRegistryMock,
  upsertCourseMock,
} = vi.hoisted(() => ({
  runSyncMock: vi.fn(),
  convertDocxMock: vi.fn(),
  createCourseMock: vi.fn(),
  updateCourseAfterSyncMock: vi.fn(),
  hashFileMock: vi.fn(),
  loadRegistryMock: vi.fn(),
  saveRegistryMock: vi.fn(),
  upsertCourseMock: vi.fn(),
}));

vi.mock("../sync.ts", () => ({ runSync: runSyncMock }));
vi.mock("../../docx-to-md/convert.ts", () => ({ convertDocx: convertDocxMock }));
vi.mock("../../notion-client/course.ts", () => ({
  createCourse: createCourseMock,
  updateCourseAfterSync: updateCourseAfterSyncMock,
}));
vi.mock("../../notion-client/hash.ts", () => ({ hashFile: hashFileMock }));
vi.mock("../../notion-client/registry.ts", () => ({
  loadRegistry: loadRegistryMock,
  saveRegistry: saveRegistryMock,
  upsertCourse: upsertCourseMock,
}));

const { parseArgv, prettifyTitle, runSyncCourse } = await import("../sync-course.ts");

const manifest: Manifest = {
  source: "curso-profesional-de-javascript.docx",
  generated: "2026-01-01T00:00:00.000Z",
  modules: [
    { number: 1, title: "Uno", file: "modules/01-uno.md", images: [], stats: { code: 0, images: 0, headings: 1, lists: 0, paras: 1, quotes: 0 } },
    { number: 2, title: "Dos", file: "modules/02-dos.md", images: [], stats: { code: 0, images: 0, headings: 1, lists: 0, paras: 1, quotes: 0 } },
  ],
};

describe("prettifyTitle()", () => {
  it('convierte guiones/underscores en espacios y capitaliza cada palabra', () => {
    expect(prettifyTitle("curso-profesional-de-javascript")).toBe("Curso Profesional De Javascript");
    expect(prettifyTitle("curso_profesional_de_javascript")).toBe("Curso Profesional De Javascript");
  });
});

describe("parseArgv()", () => {
  it("devuelve null si falta el .docx", () => {
    expect(parseArgv(["--area", "Frontend", "--plataforma", "Platzi"])).toBeNull();
  });

  it("parsea posicionales + flags en cualquier posición", () => {
    expect(
      parseArgv(["curso.docx", "2", "--area", "Frontend", "--plataforma", "Platzi", "--estado", "En curso", "--titulo", "Mi Curso", "--dry-run", "--force"]),
    ).toEqual({
      docxPath: "curso.docx",
      moduleNumber: 2,
      dryRun: true,
      force: true,
      area: "Frontend",
      plataforma: "Platzi",
      estado: "En curso",
      titulo: "Mi Curso",
    });
  });

  it("sin flags devuelve los opcionales undefined y booleanos en false", () => {
    expect(parseArgv(["curso.docx"])).toEqual({
      docxPath: "curso.docx",
      moduleNumber: undefined,
      dryRun: false,
      force: false,
      area: undefined,
      plataforma: undefined,
      estado: undefined,
      titulo: undefined,
    });
  });
});

describe("runSyncCourse()", () => {
  let dir: string;
  let docxPath: string;
  const originalDbId = process.env.NOTION_CURSOS_DATABASE_ID;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sync-course-cli-"));
    docxPath = join(dir, "curso-profesional-de-javascript.docx");
    writeFileSync(docxPath, "");

    runSyncMock.mockReset().mockResolvedValue(undefined);
    convertDocxMock.mockReset().mockReturnValue(manifest);
    createCourseMock.mockReset().mockResolvedValue("page-nuevo");
    updateCourseAfterSyncMock.mockReset().mockResolvedValue(undefined);
    hashFileMock.mockReset().mockReturnValue("hash-123");
    loadRegistryMock.mockReset().mockReturnValue({});
    saveRegistryMock.mockReset();
    upsertCourseMock.mockReset();
    process.env.NOTION_CURSOS_DATABASE_ID = "db-cursos";
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalDbId === undefined) delete process.env.NOTION_CURSOS_DATABASE_ID;
    else process.env.NOTION_CURSOS_DATABASE_ID = originalDbId;
  });

  it("slug nuevo sin --area/--plataforma lanza error de uso antes de tocar la red", async () => {
    await expect(runSyncCourse({ docxPath, dryRun: false, force: false })).rejects.toThrow(
      /--area.*--plataforma/,
    );
    expect(createCourseMock).not.toHaveBeenCalled();
    expect(runSyncMock).not.toHaveBeenCalled();
    expect(convertDocxMock).not.toHaveBeenCalled();
  });

  it("slug nuevo sin NOTION_CURSOS_DATABASE_ID lanza error de configuración antes de llamar a createCourse", async () => {
    delete process.env.NOTION_CURSOS_DATABASE_ID;

    await expect(
      runSyncCourse({ docxPath, dryRun: false, force: false, area: "Frontend", plataforma: "Platzi" }),
    ).rejects.toThrow(/NOTION_CURSOS_DATABASE_ID/);
    expect(createCourseMock).not.toHaveBeenCalled();
  });

  it("slug nuevo con --dry-run no llama a createCourse, upsertCourse, saveRegistry ni runSync", async () => {
    await runSyncCourse({ docxPath, dryRun: true, force: false, area: "Frontend", plataforma: "Platzi" });

    expect(createCourseMock).not.toHaveBeenCalled();
    expect(upsertCourseMock).not.toHaveBeenCalled();
    expect(saveRegistryMock).not.toHaveBeenCalled();
    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("slug nuevo sin --dry-run llama en orden: createCourse → upsertCourse+saveRegistry → runSync → updateCourseAfterSync", async () => {
    await runSyncCourse({ docxPath, dryRun: false, force: false, area: "Frontend", plataforma: "Platzi" });

    expect(createCourseMock).toHaveBeenCalledWith(
      "db-cursos",
      expect.objectContaining({ area: "Frontend", plataforma: "Platzi", estado: "Terminado", modulos: 2 }),
    );
    expect(upsertCourseMock).toHaveBeenCalledWith(
      {},
      "curso-profesional-de-javascript",
      expect.objectContaining({ pageId: "page-nuevo", docxHash: "hash-123" }),
    );
    expect(runSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ docxPath, parentId: "page-nuevo", dryRun: false, force: false }),
    );
    expect(updateCourseAfterSyncMock).toHaveBeenCalledWith("page-nuevo", 2);

    const createOrder = createCourseMock.mock.invocationCallOrder[0];
    const upsertOrder = upsertCourseMock.mock.invocationCallOrder[0];
    const saveOrder = saveRegistryMock.mock.invocationCallOrder[0];
    const runOrder = runSyncMock.mock.invocationCallOrder[0];
    const updateOrder = updateCourseAfterSyncMock.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(upsertOrder);
    expect(upsertOrder).toBeLessThan(saveOrder);
    expect(saveOrder).toBeLessThan(runOrder);
    expect(runOrder).toBeLessThan(updateOrder);
  });

  it("--estado ausente aplica el default Terminado; --titulo explícito pisa prettifyTitle", async () => {
    await runSyncCourse({
      docxPath,
      dryRun: false,
      force: false,
      area: "Frontend",
      plataforma: "Platzi",
      titulo: "Título Custom",
    });

    expect(createCourseMock).toHaveBeenCalledWith(
      "db-cursos",
      expect.objectContaining({ estado: "Terminado", titulo: "Título Custom" }),
    );
  });

  it("slug nuevo donde runSync lanza: upsertCourse+saveRegistry ya se llamaron, updateCourseAfterSync no se llama", async () => {
    runSyncMock.mockReset().mockRejectedValue(new Error("falló el push"));

    await expect(
      runSyncCourse({ docxPath, dryRun: false, force: false, area: "Frontend", plataforma: "Platzi" }),
    ).rejects.toThrow("falló el push");

    expect(upsertCourseMock).toHaveBeenCalledTimes(1);
    expect(saveRegistryMock).toHaveBeenCalledTimes(1);
    expect(updateCourseAfterSyncMock).not.toHaveBeenCalled();
  });

  it("slug ya registrado resuelve el pageId del registro sin exigir --area/--plataforma", async () => {
    loadRegistryMock.mockReturnValue({
      "curso-profesional-de-javascript": {
        pageId: "page-existente",
        docxFileName: "curso-profesional-de-javascript.docx",
        docxHash: "hash-vieja",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
    } satisfies CourseRegistry);

    await runSyncCourse({ docxPath, dryRun: false, force: false });

    expect(runSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ docxPath, parentId: "page-existente", dryRun: false, force: false }),
    );
    expect(createCourseMock).not.toHaveBeenCalled();
    expect(upsertCourseMock).toHaveBeenCalledTimes(1);
    expect(saveRegistryMock).toHaveBeenCalledTimes(1);
    expect(updateCourseAfterSyncMock).toHaveBeenCalledWith("page-existente", 2);

    const runOrder = runSyncMock.mock.invocationCallOrder[0];
    const upsertOrder = upsertCourseMock.mock.invocationCallOrder[0];
    const saveOrder = saveRegistryMock.mock.invocationCallOrder[0];
    const updateOrder = updateCourseAfterSyncMock.mock.invocationCallOrder[0];
    expect(runOrder).toBeLessThan(upsertOrder);
    expect(upsertOrder).toBeLessThan(saveOrder);
    expect(saveOrder).toBeLessThan(updateOrder);
  });

  it("slug ya registrado con --dry-run solo delega en runSync con dryRun: true, sin tocar registro", async () => {
    loadRegistryMock.mockReturnValue({
      "curso-profesional-de-javascript": {
        pageId: "page-existente",
        docxFileName: "curso-profesional-de-javascript.docx",
        docxHash: "hash-vieja",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
    } satisfies CourseRegistry);

    await runSyncCourse({ docxPath, dryRun: true, force: false });

    expect(runSyncMock).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(upsertCourseMock).not.toHaveBeenCalled();
    expect(saveRegistryMock).not.toHaveBeenCalled();
    expect(updateCourseAfterSyncMock).not.toHaveBeenCalled();
  });

  it("slug ya registrado donde runSync lanza: no llama a upsertCourse/saveRegistry/updateCourseAfterSync", async () => {
    loadRegistryMock.mockReturnValue({
      "curso-profesional-de-javascript": {
        pageId: "page-existente",
        docxFileName: "curso-profesional-de-javascript.docx",
        docxHash: "hash-vieja",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
    } satisfies CourseRegistry);
    runSyncMock.mockReset().mockRejectedValue(new Error("falló el push"));

    await expect(runSyncCourse({ docxPath, dryRun: false, force: false })).rejects.toThrow("falló el push");

    expect(upsertCourseMock).not.toHaveBeenCalled();
    expect(saveRegistryMock).not.toHaveBeenCalled();
    expect(updateCourseAfterSyncMock).not.toHaveBeenCalled();
  });
});
