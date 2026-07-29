import { describe, expect, it } from "vitest";
import { classifyStructure, tokenize } from "../tokenizer.ts";

describe("tokenize: agrupación de líneas", () => {
  it("agrupa líneas no vacías consecutivas en una sola unidad de párrafo", () => {
    const units = tokenize("línea uno\nlínea dos\n\nlínea tres");
    expect(units).toEqual([
      { type: "para", lines: ["línea uno", "línea dos"] },
      { type: "para", lines: ["línea tres"] },
    ]);
  });

  it("ignora líneas vacías entre unidades", () => {
    const units = tokenize("\n\npárrafo\n\n\n");
    expect(units).toEqual([{ type: "para", lines: ["párrafo"] }]);
  });

  it("clasifica un encabezado en su propia unidad", () => {
    const units = tokenize("## Título del módulo");
    expect(units).toEqual([{ type: "heading", level: 2, text: "Título del módulo" }]);
  });

  it("un heading solo cuenta como tal si está solo en su bloque de líneas", () => {
    const units = tokenize("# Titulo\nno es parte del heading");
    expect(units).toEqual([{ type: "para", lines: ["# Titulo", "no es parte del heading"] }]);
  });

  it("desescapa el texto del heading con unescapeProse", () => {
    const units = tokenize("# Precio\\: 100");
    expect(units).toEqual([{ type: "heading", level: 1, text: "Precio: 100" }]);
  });

  it("clasifica una lista", () => {
    const units = tokenize("- item uno\n- item dos");
    expect(units).toEqual([{ type: "list", lines: ["- item uno", "- item dos"] }]);
  });

  it("clasifica una lista numerada", () => {
    const units = tokenize("1. primero\n2. segundo");
    expect(units).toEqual([{ type: "list", lines: ["1. primero", "2. segundo"] }]);
  });

  it("clasifica una quote", () => {
    const units = tokenize("> una cita\n> continúa");
    expect(units).toEqual([{ type: "quote", lines: ["> una cita", "> continúa"] }]);
  });
});

describe("tokenize: fences", () => {
  it("preserva un fence de código tal cual, con delimitadores", () => {
    const units = tokenize("```js\nconst x = 1;\n```");
    expect(units).toEqual([{ type: "fence", lines: ["```js", "const x = 1;", "```"] }]);
  });

  it("descarta un bloque ```{=html} completo (DEFECTO 7)", () => {
    const units = tokenize("antes\n\n```{=html}\n<div>separador</div>\n```\n\ndespués");
    expect(units).toEqual([
      { type: "para", lines: ["antes"] },
      { type: "para", lines: ["después"] },
    ]);
  });

  it("descarta un bloque ```{=html} vacío sin quedarse trabado (DEFECTO 9)", () => {
    const units = tokenize("```{=html}\n```\ndespués");
    expect(units).toEqual([{ type: "para", lines: ["después"] }]);
  });
});

describe("tokenize / classifyStructure: imágenes", () => {
  it("extrae una imagen sola en su propia unidad", () => {
    const units = tokenize("![](./media/image1.png)");
    expect(units).toEqual([{ type: "image", src: "./media/image1.png" }]);
  });

  it("separa el texto antes y después de una imagen pegada", () => {
    const units = classifyStructure(["texto antes![](./media/image1.png)texto después"]);
    expect(units).toEqual([
      { type: "para", lines: ["texto antes"] },
      { type: "image", src: "./media/image1.png" },
      { type: "para", lines: ["texto después"] },
    ]);
  });

  it("extrae varias imágenes lado a lado en la misma línea", () => {
    const units = classifyStructure(["![](./media/image1.png)![](./media/image2.png)"]);
    expect(units).toEqual([
      { type: "image", src: "./media/image1.png" },
      { type: "image", src: "./media/image2.png" },
    ]);
  });

  it("mantiene el orden entre texto e imágenes intercaladas en varias líneas", () => {
    const units = classifyStructure([
      "primera línea de texto",
      "![](./media/image1.png)",
      "última línea de texto",
    ]);
    expect(units).toEqual([
      { type: "para", lines: ["primera línea de texto"] },
      { type: "image", src: "./media/image1.png" },
      { type: "para", lines: ["última línea de texto"] },
    ]);
  });

  it("ignora atributos de tamaño de pandoc junto a la imagen", () => {
    const units = tokenize('![](./media/image1.png){width="3.4in" height="2.0in"}');
    expect(units).toEqual([{ type: "image", src: "./media/image1.png" }]);
  });
});
