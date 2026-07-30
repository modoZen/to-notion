import { describe, expect, it } from "vitest";
import { MAX_TEXT, parseInline, splitRichText } from "../rich-text.ts";

describe("parseInline", () => {
  it("negrita **texto**", () => {
    expect(parseInline("**hola**")).toEqual([
      { type: "text", text: { content: "hola" }, annotations: { bold: true } },
    ]);
  });

  it("cursiva *texto*", () => {
    expect(parseInline("*hola*")).toEqual([
      { type: "text", text: { content: "hola" }, annotations: { italic: true } },
    ]);
  });

  it("código en línea", () => {
    expect(parseInline("usa `const x = 1`")).toEqual([
      { type: "text", text: { content: "usa " } },
      { type: "text", text: { content: "const x = 1" }, annotations: { code: true } },
    ]);
  });

  it("enlace [texto](url)", () => {
    expect(parseInline("mirá [este link](https://example.com)")).toEqual([
      { type: "text", text: { content: "mirá " } },
      { type: "text", text: { content: "este link", link: { url: "https://example.com" } } },
    ]);
  });

  it("URL suelta", () => {
    expect(parseInline("visitá https://example.com/x ahora")).toEqual([
      { type: "text", text: { content: "visitá " } },
      { type: "text", text: { content: "https://example.com/x", link: { url: "https://example.com/x" } } },
      { type: "text", text: { content: " ahora" } },
    ]);
  });

  it("escapes de pandoc: \\* \\_ \\` \\# \\\\", () => {
    expect(parseInline("\\*no negrita\\* \\_no cursiva\\_ \\`no codigo\\` \\# no h1 \\\\")).toEqual([
      { type: "text", text: { content: "*no negrita* _no cursiva_ `no codigo` # no h1 \\" } },
    ]);
  });

  it("anidamiento negrita+cursiva", () => {
    expect(parseInline("**muy *importante* hoy**")).toEqual([
      { type: "text", text: { content: "muy " }, annotations: { bold: true } },
      { type: "text", text: { content: "importante" }, annotations: { italic: true, bold: true } },
      { type: "text", text: { content: " hoy" }, annotations: { bold: true } },
    ]);
  });

  it("texto sin marcado devuelve un solo fragmento", () => {
    expect(parseInline("texto plano")).toEqual([{ type: "text", text: { content: "texto plano" } }]);
  });

  it("string vacío devuelve array vacío", () => {
    expect(parseInline("")).toEqual([]);
  });
});

describe("splitRichText", () => {
  it("no toca fragmentos de 2000 caracteres o menos", () => {
    const rt = { type: "text" as const, text: { content: "a".repeat(MAX_TEXT) } };
    expect(splitRichText([rt])).toEqual([rt]);
  });

  it("parte un texto de más de 2000 caracteres cortando en un espacio", () => {
    const content = `${"a".repeat(MAX_TEXT - 10)} ${"b".repeat(50)}`;
    const rt = { type: "text" as const, text: { content } };
    const out = splitRichText([rt]);

    expect(out.length).toBe(2);
    for (const frag of out) {
      expect(frag.text.content.length).toBeLessThanOrEqual(MAX_TEXT);
    }
    expect(out.map((f) => f.text.content).join("")).toBe(content);
    expect(out[0].text.content.endsWith(" ")).toBe(false);
  });

  it("corte duro cuando no hay espacio útil cerca del límite", () => {
    const content = "a".repeat(MAX_TEXT + 100);
    const rt = { type: "text" as const, text: { content } };
    const out = splitRichText([rt]);

    expect(out.length).toBe(2);
    expect(out[0].text.content.length).toBe(MAX_TEXT);
    expect(out.map((f) => f.text.content).join("")).toBe(content);
  });
});
