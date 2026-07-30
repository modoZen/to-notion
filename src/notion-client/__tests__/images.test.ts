import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotionBlock } from "../../md-to-notion/types.ts";

const notionMock = vi.fn();
vi.mock("../client.ts", () => ({ notion: notionMock }));

describe("uploadImage()", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notion-client-img-"));
    notionMock.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rechaza un archivo que supera 20 MiB con un error que menciona el tamaño", async () => {
    const big = Buffer.alloc(21 * 1024 * 1024);
    const filePath = join(dir, "grande.png");
    writeFileSync(filePath, big);

    const { uploadImage } = await import("../images.ts");
    await expect(uploadImage(filePath)).rejects.toThrow(/21\.0 MB supera el límite de 20 MiB/);
    expect(notionMock).not.toHaveBeenCalled();
  });

  it("mapea una extensión conocida al Content-Type correcto", async () => {
    const filePath = join(dir, "foto.jpg");
    writeFileSync(filePath, "contenido");
    notionMock
      .mockResolvedValueOnce({ id: "file-1", upload_url: "https://api.notion.com/v1/file_uploads/file-1/send" })
      .mockResolvedValueOnce({});

    const { uploadImage } = await import("../images.ts");
    const id = await uploadImage(filePath);

    expect(id).toBe("file-1");
    expect(notionMock).toHaveBeenNthCalledWith(1, "POST", "/file_uploads", {
      filename: "foto.jpg",
      content_type: "image/jpeg",
    });
  });

  it("cae a application/octet-stream para una extensión desconocida", async () => {
    const filePath = join(dir, "archivo.xyz");
    writeFileSync(filePath, "contenido");
    notionMock
      .mockResolvedValueOnce({ id: "file-2", upload_url: "https://api.notion.com/v1/file_uploads/file-2/send" })
      .mockResolvedValueOnce({});

    const { uploadImage } = await import("../images.ts");
    await uploadImage(filePath);

    expect(notionMock).toHaveBeenNthCalledWith(1, "POST", "/file_uploads", {
      filename: "archivo.xyz",
      content_type: "application/octet-stream",
    });
  });
});

describe("resolveImages()", () => {
  function markerBlock(token: string): NotionBlock {
    return {
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: `![](${token})` } }] },
      _marker: token,
    };
  }

  it("sustituye un bloque _marker por un bloque image cuando hay id disponible", async () => {
    const { resolveImages } = await import("../images.ts");
    const blocks = [markerBlock("image1.png")];

    const result = resolveImages(blocks, { "image1.png": "file-123" });

    expect(result).toEqual([
      {
        object: "block",
        type: "image",
        image: { type: "file_upload", file_upload: { id: "file-123" }, caption: [] },
      },
    ]);
  });

  it("deja el bloque de texto original cuando falta el id", async () => {
    const { resolveImages } = await import("../images.ts");
    const blocks = [markerBlock("image1.png")];

    const result = resolveImages(blocks, {});

    expect(result).toEqual([
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: "![](image1.png)" } }] },
      },
    ]);
  });

  it("deja pasar sin cambios los bloques que no son marcador", async () => {
    const { resolveImages } = await import("../images.ts");
    const heading: NotionBlock = {
      object: "block",
      type: "heading_1",
      heading_1: { rich_text: [{ type: "text", text: { content: "Título" } }], is_toggleable: false },
    };

    expect(resolveImages([heading], {})).toEqual([heading]);
  });
});
