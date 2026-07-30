import { describe, expect, it } from "vitest";
import { mdToBlocks } from "../blocks.ts";

describe("mdToBlocks", () => {
  it("mapea headings # ## ### a heading_1/2/3 con is_toggleable: false", () => {
    const { blocks } = mdToBlocks("# Título 1\n\n## Título 2\n\n### Título 3");

    expect(blocks).toEqual([
      {
        object: "block",
        type: "heading_1",
        heading_1: { rich_text: [{ type: "text", text: { content: "Título 1" } }], is_toggleable: false },
      },
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: "Título 2" } }], is_toggleable: false },
      },
      {
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: [{ type: "text", text: { content: "Título 3" } }], is_toggleable: false },
      },
    ]);
  });

  it("mapea una línea de texto a un bloque paragraph", () => {
    const { blocks } = mdToBlocks("Esto es un párrafo con **negrita**.");

    expect(blocks).toEqual([
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: "Esto es un párrafo con " } },
            { type: "text", text: { content: "negrita" }, annotations: { bold: true } },
            { type: "text", text: { content: "." } },
          ],
        },
      },
    ]);
  });

  it("mapea un fence de código con lenguaje soportado a bloque code", () => {
    const md = "```javascript\nconst x = 1;\nconsole.log(x);\n```";
    const { blocks } = mdToBlocks(md);

    expect(blocks).toEqual([
      {
        object: "block",
        type: "code",
        code: {
          language: "javascript",
          rich_text: [{ type: "text", text: { content: "const x = 1;\nconsole.log(x);" } }],
        },
      },
    ]);
  });

  it("un lenguaje no soportado en el fence cae a 'plain text'", () => {
    const md = "```cobol\nDISPLAY 'hola'.\n```";
    const { blocks } = mdToBlocks(md);

    expect(blocks[0]).toMatchObject({ type: "code", code: { language: "plain text" } });
  });

  it("un fence sin cierre igual se cierra (avanza hasta el final)", () => {
    const md = "```bash\necho hola";
    const { blocks } = mdToBlocks(md);

    expect(blocks).toEqual([
      {
        object: "block",
        type: "code",
        code: { language: "bash", rich_text: [{ type: "text", text: { content: "echo hola" } }] },
      },
    ]);
  });

  it("markdown de un módulo real simplificado combina heading, párrafo y código", () => {
    const md = [
      "# Módulo 1: Introducción",
      "",
      "## Variables",
      "",
      "En JavaScript las variables se declaran con `let` o `const`.",
      "",
      "```javascript",
      "const nombre = 'mundo';",
      "console.log(`Hola ${nombre}`);",
      "```",
      "",
      "Eso es todo por este módulo.",
    ].join("\n");

    const { blocks, images } = mdToBlocks(md);

    expect(blocks.map((b) => b.type)).toEqual(["heading_1", "heading_2", "paragraph", "code", "paragraph"]);
    expect(images).toEqual([]);
  });

  it("ignora líneas en blanco entre bloques", () => {
    const { blocks } = mdToBlocks("Primero.\n\n\nSegundo.");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });
});
