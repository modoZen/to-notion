import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushModuleInput, SyncState } from "../types.ts";

const { notionMock, uploadImageMock, saveStateMock } = vi.hoisted(() => ({
  notionMock: vi.fn(),
  uploadImageMock: vi.fn(),
  saveStateMock: vi.fn(),
}));

vi.mock("../client.ts", () => ({ notion: notionMock }));
vi.mock("../images.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../images.ts")>();
  return { ...actual, uploadImage: uploadImageMock };
});
vi.mock("../state.ts", () => ({ saveState: saveStateMock }));

const { pushModule } = await import("../push-module.ts");

describe("pushModule()", () => {
  let dir: string;
  let mediaDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notion-client-push-"));
    mediaDir = join(dir, "media");
    mkdirSync(mediaDir);
    notionMock.mockReset();
    uploadImageMock.mockReset();
    saveStateMock.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeMd(name: string, content: string): string {
    const p = join(dir, name);
    writeFileSync(p, content, "utf8");
    return p;
  }

  const mod: PushModuleInput = { number: 1, title: "Introducción" };

  it("salta un módulo ya done sin hacer ninguna llamada de red", async () => {
    const state: SyncState = { "parent-1": { modules: { "1": { pageId: "page-old", done: true } } } };

    await pushModule(mod, join(dir, "no-existe.md"), mediaDir, "parent-1", dir, state, false, false);

    expect(notionMock).not.toHaveBeenCalled();
    expect(uploadImageMock).not.toHaveBeenCalled();
    expect(saveStateMock).not.toHaveBeenCalled();
  });

  it("con force: true no saltea un módulo ya done: archiva la página vieja y crea una nueva", async () => {
    const mdPath = writeMd("mod.md", "# Introducción\n\nHola mundo.\n");
    const state: SyncState = { "parent-1": { modules: { "1": { pageId: "page-old", done: true } } } };
    notionMock
      .mockResolvedValueOnce({ results: [{ id: "page-old" }] }) // GET /blocks/:parentId/children
      .mockResolvedValueOnce({}) // PATCH archivar
      .mockResolvedValueOnce({ id: "page-new", url: "https://notion.so/page-new" }); // POST /pages

    await pushModule(mod, mdPath, mediaDir, "parent-1", dir, state, false, true);

    expect(notionMock).toHaveBeenNthCalledWith(1, "GET", "/blocks/parent-1/children");
    expect(notionMock).toHaveBeenNthCalledWith(2, "PATCH", "/pages/page-old", { in_trash: true });
    expect(notionMock).toHaveBeenNthCalledWith(
      3,
      "POST",
      "/pages",
      expect.objectContaining({ parent: { page_id: "parent-1" } }),
    );
  });

  describe("reposicionamiento de la página rehecha", () => {
    it("ancla en el hermano anterior cuando el pageId guardado sí aparece entre los hijos actuales", async () => {
      const mdPath = writeMd("mod.md", "# Introducción\n\nHola mundo.\n");
      const state: SyncState = { "parent-1": { modules: { "2": { pageId: "page-2", done: true } } } };
      const mod2: PushModuleInput = { number: 2, title: "Dos" };
      notionMock
        .mockResolvedValueOnce({ results: [{ id: "page-1" }, { id: "page-2" }, { id: "page-3" }] }) // GET children
        .mockResolvedValueOnce({}) // PATCH archivar
        .mockResolvedValueOnce({ id: "page-2-new", url: "https://notion.so/page-2-new" }); // POST /pages

      await pushModule(mod2, mdPath, mediaDir, "parent-1", dir, state, false, true);

      const pageCall = notionMock.mock.calls.find((c) => c[0] === "POST" && c[1] === "/pages");
      expect(pageCall?.[2].position).toEqual({ type: "after_block", after_block: { id: "page-1" } });
    });

    it("ancla en page_start cuando el pageId guardado es el primer hijo", async () => {
      const mdPath = writeMd("mod.md", "# Introducción\n\nHola mundo.\n");
      const state: SyncState = { "parent-1": { modules: { "1": { pageId: "page-1", done: true } } } };
      notionMock
        .mockResolvedValueOnce({ results: [{ id: "page-1" }, { id: "page-2" }] }) // GET children
        .mockResolvedValueOnce({}) // PATCH archivar
        .mockResolvedValueOnce({ id: "page-1-new", url: "https://notion.so/page-1-new" }); // POST /pages

      await pushModule(mod, mdPath, mediaDir, "parent-1", dir, state, false, true);

      const pageCall = notionMock.mock.calls.find((c) => c[0] === "POST" && c[1] === "/pages");
      expect(pageCall?.[2].position).toEqual({ type: "page_start" });
    });

    it("si el pageId guardado no aparece entre los hijos, ancla después del primer módulo anterior que sí aparece", async () => {
      const mdPath = writeMd("mod.md", "# Introducción\n\nHola mundo.\n");
      const state: SyncState = {
        "parent-1": {
          modules: {
            "1": { pageId: "page-1", done: true },
            "2": { pageId: "page-2-borrada", done: true }, // ya no existe en Notion
            "3": { pageId: "page-3", done: true },
          },
        },
      };
      const mod3: PushModuleInput = { number: 3, title: "Tres" };
      notionMock
        .mockResolvedValueOnce({ results: [{ id: "page-1" }, { id: "page-3" }] }) // GET children: page-2-borrada ya no está
        .mockResolvedValueOnce({}) // PATCH archivar
        .mockResolvedValueOnce({ id: "page-3-new", url: "https://notion.so/page-3-new" }); // POST /pages

      await pushModule(mod3, mdPath, mediaDir, "parent-1", dir, state, false, true);

      const pageCall = notionMock.mock.calls.find((c) => c[0] === "POST" && c[1] === "/pages");
      expect(pageCall?.[2].position).toEqual({ type: "after_block", after_block: { id: "page-1" } });
    });

    it("si ningún módulo anterior aparece entre los hijos actuales, ancla en page_start", async () => {
      const mdPath = writeMd("mod.md", "# Introducción\n\nHola mundo.\n");
      const state: SyncState = {
        "parent-1": {
          modules: {
            "1": { pageId: "page-1-borrada", done: true },
            "2": { pageId: "page-2-borrada", done: true },
            "3": { pageId: "page-3-borrada", done: true },
          },
        },
      };
      const mod3: PushModuleInput = { number: 3, title: "Tres" };
      notionMock
        .mockResolvedValueOnce({ results: [{ id: "otra-pagina-sin-relacion" }] }) // GET children
        .mockResolvedValueOnce({}) // PATCH archivar
        .mockResolvedValueOnce({ id: "page-3-new", url: "https://notion.so/page-3-new" }); // POST /pages

      await pushModule(mod3, mdPath, mediaDir, "parent-1", dir, state, false, true);

      const pageCall = notionMock.mock.calls.find((c) => c[0] === "POST" && c[1] === "/pages");
      expect(pageCall?.[2].position).toEqual({ type: "page_start" });
    });

    it("si el archivado de la página vieja falla, no aborta: crea la página nueva igual con el position ya calculado", async () => {
      const mdPath = writeMd("mod.md", "# Introducción\n\nHola mundo.\n");
      const state: SyncState = { "parent-1": { modules: { "2": { pageId: "page-2", done: true } } } };
      const mod2: PushModuleInput = { number: 2, title: "Dos" };
      notionMock
        .mockResolvedValueOnce({ results: [{ id: "page-1" }, { id: "page-2" }] }) // GET children
        .mockRejectedValueOnce(new Error("PATCH /pages/page-2 -> 404: not_found")) // PATCH archivar falla
        .mockResolvedValueOnce({ id: "page-2-new", url: "https://notion.so/page-2-new" }); // POST /pages

      await pushModule(mod2, mdPath, mediaDir, "parent-1", dir, state, false, true);

      const pageCall = notionMock.mock.calls.find((c) => c[0] === "POST" && c[1] === "/pages");
      expect(pageCall).toBeDefined();
      expect(pageCall?.[2].position).toEqual({ type: "after_block", after_block: { id: "page-1" } });
    });
  });

  it("archiva la página de un intento previo incompleto antes de rehacer", async () => {
    const mdPath = writeMd("mod.md", "# Introducción\n\nHola mundo.\n");
    const state: SyncState = { "parent-1": { modules: { "1": { pageId: "page-old", done: false } } } };
    notionMock
      .mockResolvedValueOnce({ results: [{ id: "page-old" }] }) // GET /blocks/:parentId/children
      .mockResolvedValueOnce({}) // PATCH archivar
      .mockResolvedValueOnce({ id: "page-new", url: "https://notion.so/page-new" }); // POST /pages

    await pushModule(mod, mdPath, mediaDir, "parent-1", dir, state, false, false);

    expect(notionMock).toHaveBeenNthCalledWith(1, "GET", "/blocks/parent-1/children");
    expect(notionMock).toHaveBeenNthCalledWith(2, "PATCH", "/pages/page-old", { in_trash: true });
    expect(notionMock).toHaveBeenNthCalledWith(
      3,
      "POST",
      "/pages",
      expect.objectContaining({ parent: { page_id: "parent-1" } }),
    );
  });

  it("con dryRun: true no hace ninguna llamada de red ni escribe estado", async () => {
    const mdPath = writeMd("mod.md", "# Introducción\n\nHola mundo.\n");
    const state: SyncState = {};

    await pushModule(mod, mdPath, mediaDir, "parent-1", dir, state, true, false);

    expect(notionMock).not.toHaveBeenCalled();
    expect(uploadImageMock).not.toHaveBeenCalled();
    expect(saveStateMock).not.toHaveBeenCalled();
  });

  it("una imagen faltante en disco deja el marcador de texto y continúa", async () => {
    const mdPath = writeMd("mod.md", "# Introducción\n\n![](image1.png)\n");
    const state: SyncState = {};
    notionMock.mockResolvedValueOnce({ id: "page-1", url: "https://notion.so/page-1" });

    await pushModule(mod, mdPath, mediaDir, "parent-1", dir, state, false, false);

    expect(uploadImageMock).not.toHaveBeenCalled();
    const pageCall = notionMock.mock.calls.find((c) => c[0] === "POST" && c[1] === "/pages");
    expect(pageCall?.[2].children).toEqual([
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: "![](image1.png)" }, annotations: { code: true } }] },
      },
    ]);
  });

  it("más de 100 bloques dispara varios PATCH /blocks/:id/children en orden", async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `Linea ${i + 1}.`);
    const mdPath = writeMd("mod.md", `# Introducción\n\n${lines.join("\n\n")}\n`);
    const state: SyncState = {};
    notionMock
      .mockResolvedValueOnce({ id: "page-1", url: "https://notion.so/page-1" }) // POST /pages
      .mockResolvedValueOnce({}) // PATCH lote 2
      .mockResolvedValueOnce({}); // PATCH lote 3

    await pushModule(mod, mdPath, mediaDir, "parent-1", dir, state, false, false);

    const patchCalls = notionMock.mock.calls.filter((c) => c[0] === "PATCH" && c[1] === "/blocks/page-1/children");
    expect(patchCalls).toHaveLength(2);
    expect(patchCalls[0][2].children).toHaveLength(100);
    expect(patchCalls[1][2].children).toHaveLength(50);
  });

  it("guarda el estado después de crear la página y de nuevo al terminar", async () => {
    const mdPath = writeMd("mod.md", "# Introducción\n\nHola mundo.\n");
    const state: SyncState = {};
    notionMock.mockResolvedValueOnce({ id: "page-1", url: "https://notion.so/page-1" });

    // saveState recibe el mismo objeto `state`, que se sigue mutando después de
    // cada llamada: se clona en cada invocación para poder comparar ambas fotos.
    const snapshots: SyncState[] = [];
    saveStateMock.mockImplementation((_outDir: string, s: SyncState) => {
      snapshots.push(JSON.parse(JSON.stringify(s)));
    });

    await pushModule(mod, mdPath, mediaDir, "parent-1", dir, state, false, false);

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]["parent-1"].modules["1"]).toEqual({ pageId: "page-1", done: false });
    expect(snapshots[1]["parent-1"].modules["1"]).toEqual({ pageId: "page-1", done: true });
  });
});
