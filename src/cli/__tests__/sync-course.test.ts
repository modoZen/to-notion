import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../docx-to-md/types.ts";
import { courseFolderName, courseSlug } from "../../docx-to-md/modules.ts";
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
  let slug: string;
  const originalDbId = process.env.NOTION_CURSOS_DATABASE_ID;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sync-course-cli-"));
    docxPath = join(dir, "curso-profesional-de-javascript.docx");
    writeFileSync(docxPath, "");
    slug = courseSlug(docxPath);

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
      slug,
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
      [slug]: {
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
      [slug]: {
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
      [slug]: {
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

  it("docxFileName pasa a ser '<carpeta>/<archivo>.docx'", async () => {
    await runSyncCourse({ docxPath, dryRun: false, force: false, area: "Frontend", plataforma: "Platzi" });

    expect(upsertCourseMock).toHaveBeenCalledWith(
      {},
      slug,
      expect.objectContaining({ docxFileName: `${basename(dir)}/curso-profesional-de-javascript.docx` }),
    );
  });
});

describe("docxFileName con carpeta contenedora (integración con upsertCourse real)", () => {
  it("dos docx con el mismo basename en carpetas distintas no colisionan en upsertCourse", async () => {
    const { upsertCourse } = await vi.importActual<typeof import("../../notion-client/registry.ts")>(
      "../../notion-client/registry.ts",
    );

    const dirA = mkdtempSync(join(tmpdir(), "sync-course-cli-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "sync-course-cli-b-"));
    const docxPathA = join(dirA, "Clases.docx");
    const docxPathB = join(dirB, "Clases.docx");

    const slugA = courseSlug(docxPathA);
    const slugB = courseSlug(docxPathB);
    const docxFileNameA = `${courseFolderName(docxPathA)}/${basename(docxPathA)}`;
    const docxFileNameB = `${courseFolderName(docxPathB)}/${basename(docxPathB)}`;

    expect(slugA).not.toBe(slugB);
    expect(docxFileNameA).not.toBe(docxFileNameB);

    const registry: CourseRegistry = {};
    expect(() =>
      upsertCourse(registry, slugA, { pageId: "page-a", docxFileName: docxFileNameA, docxHash: "hash-a" }),
    ).not.toThrow();
    expect(() =>
      upsertCourse(registry, slugB, { pageId: "page-b", docxFileName: docxFileNameB, docxHash: "hash-b" }),
    ).not.toThrow();

    expect(registry[slugA].docxFileName).toBe(docxFileNameA);
    expect(registry[slugB].docxFileName).toBe(docxFileNameB);

    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it("el mismo docxPath en corridas sucesivas sigue actualizando la misma entrada sin lanzar", async () => {
    const { upsertCourse } = await vi.importActual<typeof import("../../notion-client/registry.ts")>(
      "../../notion-client/registry.ts",
    );

    const dir = mkdtempSync(join(tmpdir(), "sync-course-cli-repeat-"));
    const docxPath = join(dir, "Clases.docx");
    const slug = courseSlug(docxPath);
    const docxFileName = `${courseFolderName(docxPath)}/${basename(docxPath)}`;

    const registry: CourseRegistry = {};
    expect(() =>
      upsertCourse(registry, slug, { pageId: "page-1", docxFileName, docxHash: "hash-1" }),
    ).not.toThrow();
    expect(() =>
      upsertCourse(registry, slug, { pageId: "page-2", docxFileName, docxHash: "hash-2" }),
    ).not.toThrow();

    expect(registry[slug].pageId).toBe("page-2");

    rmSync(dir, { recursive: true, force: true });
  });
});
