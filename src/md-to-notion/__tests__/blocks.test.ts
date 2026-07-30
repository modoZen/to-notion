import { describe, expect, it } from "vitest";
import { batch, mdToBlocks } from "../blocks.ts";
import type { NotionBlock } from "../types.ts";

describe("mdToBlocks", () => {
  it("mapea headings # ## ### a heading_1/2/3 con is_toggleable: false", () => {
    // el heading # va después de un párrafo para no confundirse con el título de página (ver test dedicado)
    const { blocks } = mdToBlocks("Intro.\n\n# Título 1\n\n## Título 2\n\n### Título 3");

    expect(blocks).toEqual([
      { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Intro." } }] } },
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

    // "# Módulo 1: Introducción" es la primera línea -> título de página, no bloque.
    expect(blocks.map((b) => b.type)).toEqual(["heading_2", "paragraph", "code", "paragraph"]);
    expect(images).toEqual([]);
  });

  it("ignora líneas en blanco entre bloques", () => {
    const { blocks } = mdToBlocks("Primero.\n\n\nSegundo.");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("lista simple con viñeta produce bulleted_list_item por línea", () => {
    const { blocks } = mdToBlocks("- uno\n- dos\n- tres");

    expect(blocks).toEqual([
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "uno" } }] },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "dos" } }] },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "tres" } }] },
      },
    ]);
  });

  it("lista anidada a dos niveles produce children dentro del item padre", () => {
    const md = "- padre 1\n    - hijo 1.1\n    - hijo 1.2\n- padre 2";
    const { blocks } = mdToBlocks(md);

    expect(blocks).toEqual([
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: "padre 1" } }],
          children: [
            {
              object: "block",
              type: "bulleted_list_item",
              bulleted_list_item: { rich_text: [{ type: "text", text: { content: "hijo 1.1" } }] },
            },
            {
              object: "block",
              type: "bulleted_list_item",
              bulleted_list_item: { rich_text: [{ type: "text", text: { content: "hijo 1.2" } }] },
            },
          ],
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "padre 2" } }] },
      },
    ]);
  });

  it("una línea en blanco no corta la lista si sigue habiendo viñetas después", () => {
    const md = "- uno\n\n- dos";
    const { blocks } = mdToBlocks(md);

    expect(blocks).toEqual([
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "uno" } }] },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "dos" } }] },
      },
    ]);
  });

  it("una línea en blanco sí corta la lista si lo que sigue no es una viñeta", () => {
    const md = "- uno\n\nPárrafo después.";
    const { blocks } = mdToBlocks(md);

    expect(blocks.map((b) => b.type)).toEqual(["bulleted_list_item", "paragraph"]);
  });

  it("lista numerada simple produce numbered_list_item por línea", () => {
    const { blocks } = mdToBlocks("1.  uno\n2.  dos\n3.  tres");

    expect(blocks).toEqual([
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [{ type: "text", text: { content: "uno" } }] },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [{ type: "text", text: { content: "dos" } }] },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [{ type: "text", text: { content: "tres" } }] },
      },
    ]);
  });

  it("lista numerada anidada a dos niveles produce children dentro del item padre", () => {
    const md = "1.  padre 1\n    1.  hijo 1.1\n    2.  hijo 1.2\n2.  padre 2";
    const { blocks } = mdToBlocks(md);

    expect(blocks).toEqual([
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: [{ type: "text", text: { content: "padre 1" } }],
          children: [
            {
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: { rich_text: [{ type: "text", text: { content: "hijo 1.1" } }] },
            },
            {
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: { rich_text: [{ type: "text", text: { content: "hijo 1.2" } }] },
            },
          ],
        },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [{ type: "text", text: { content: "padre 2" } }] },
      },
    ]);
  });

  it("una línea en blanco no corta la lista numerada si sigue habiendo números después", () => {
    const md = "1.  uno\n\n2.  dos";
    const { blocks } = mdToBlocks(md);

    expect(blocks).toEqual([
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [{ type: "text", text: { content: "uno" } }] },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [{ type: "text", text: { content: "dos" } }] },
      },
    ]);
  });

  it("una línea en blanco sí corta la lista numerada si lo que sigue no es una línea numerada", () => {
    const md = "1.  uno\n\nPárrafo después.";
    const { blocks } = mdToBlocks(md);

    expect(blocks.map((b) => b.type)).toEqual(["numbered_list_item", "paragraph"]);
  });

  it("imagen en modo 'callout' produce un bloque callout con ícono 🖼️", () => {
    const { blocks, images } = mdToBlocks("![](image1.png)", { imageMode: "callout" });

    expect(blocks).toEqual([
      {
        object: "block",
        type: "callout",
        callout: {
          icon: { type: "emoji", emoji: "🖼️" },
          color: "gray_background",
          rich_text: [{ type: "text", text: { content: "![](image1.png)" }, annotations: { code: true } }],
        },
      },
    ]);
    expect(images).toEqual(["image1.png"]);
  });

  it("imagen en modo 'marker' produce un paragraph con _marker seteado al token", () => {
    const { blocks, images } = mdToBlocks("![](image1.png)", { imageMode: "marker" });

    expect(blocks).toEqual([
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: "![](image1.png)" }, annotations: { code: true } }],
        },
        _marker: "image1.png",
      },
    ]);
    expect(images).toEqual(["image1.png"]);
  });

  it("modo de imagen por defecto es 'callout'", () => {
    const { blocks } = mdToBlocks("![](image1.png)");
    expect(blocks[0].type).toBe("callout");
  });

  it("la primera línea '# Título' se descarta como título de página, no como bloque", () => {
    const { blocks } = mdToBlocks("# Módulo 1\n\nUn párrafo.");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("sin línea de título: el primer heading se mantiene como bloque", () => {
    const { blocks } = mdToBlocks("## No es título de página\n\nUn párrafo.");
    expect(blocks.map((b) => b.type)).toEqual(["heading_2", "paragraph"]);
  });
});

function paragraph(content: string): NotionBlock {
  return { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content } }] } };
}

describe("batch", () => {
  it("con menos de 100 bloques devuelve un solo lote", () => {
    const blocks = Array.from({ length: 30 }, (_, i) => paragraph(String(i)));
    const out = batch(blocks);

    expect(out.length).toBe(1);
    expect(out[0]).toEqual(blocks);
  });

  it("con más de 100 bloques los agrupa en lotes de a 100", () => {
    const blocks = Array.from({ length: 250 }, (_, i) => paragraph(String(i)));
    const out = batch(blocks);

    expect(out.length).toBe(3);
    expect(out[0].length).toBe(100);
    expect(out[1].length).toBe(100);
    expect(out[2].length).toBe(50);
    expect(out.flat()).toEqual(blocks);
  });

  it("respeta un tamaño de lote personalizado", () => {
    const blocks = Array.from({ length: 5 }, (_, i) => paragraph(String(i)));
    const out = batch(blocks, 2);

    expect(out).toEqual([[blocks[0], blocks[1]], [blocks[2], blocks[3]], [blocks[4]]]);
  });
});
