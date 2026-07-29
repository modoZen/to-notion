import { describe, expect, it } from "vitest";
import type { Unit } from "../../types.ts";
import { classifyUnit, fuseSplitBlocks, resolveUnknowns } from "../units.ts";

describe("classifyUnit — unidades que no son para/quote", () => {
  it("devuelve el propio tipo para heading, list, image y fence", () => {
    expect(classifyUnit({ type: "heading", level: 1, text: "Título" })).toBe("heading");
    expect(classifyUnit({ type: "list", lines: ["- item"] })).toBe("list");
    expect(classifyUnit({ type: "image", src: "./media/x.png" })).toBe("image");
    expect(classifyUnit({ type: "fence", lines: ["```js", "1", "```"] })).toBe("fence");
  });
});

describe("classifyUnit — unidades 'para' (mayoría con sesgo)", () => {
  it("todas las líneas votan código", () => {
    const unit: Unit = { type: "para", lines: ["const x = 1;", "const y = 2;"] };
    expect(classifyUnit(unit)).toBe("code");
  });

  it("todas las líneas votan prosa", () => {
    const unit: Unit = {
      type: "para",
      lines: [
        "En este módulo vamos a aprender los conceptos básicos",
        "Otra solución",
      ],
    };
    expect(classifyUnit(unit)).toBe("prose");
  });

  it("mayoría de código gana sobre una línea prosa suelta", () => {
    const unit: Unit = {
      type: "para",
      lines: ["const x = 1;", "const y = 2;", "Otra solución"],
    };
    expect(classifyUnit(unit)).toBe("code");
  });

  it("empate entre código y prosa queda unknown", () => {
    const unit: Unit = { type: "para", lines: ["const x = 1;", "Otra solución"] };
    expect(classifyUnit(unit)).toBe("unknown");
  });
});

describe("classifyUnit — unidades 'quote'", () => {
  it("una cita con código adentro se reclasifica como código", () => {
    const unit: Unit = { type: "quote", lines: ["> const x = 1;", "> const y = 2;"] };
    expect(classifyUnit(unit)).toBe("code");
  });

  it("una cita sin señales de código se queda como quote", () => {
    const unit: Unit = { type: "quote", lines: ["> Una cita cualquiera del autor"] };
    expect(classifyUnit(unit)).toBe("quote");
  });
});

describe("resolveUnknowns", () => {
  it("un unknown rodeado de código a ambos lados se vuelve código", () => {
    expect(resolveUnknowns(["code", "unknown", "code"])).toEqual(["code", "code", "code"]);
  });

  it("un unknown rodeado de prosa se vuelve prosa", () => {
    expect(resolveUnknowns(["prose", "unknown", "prose"])).toEqual(["prose", "prose", "prose"]);
  });

  it("un unknown con código de un lado y prosa del otro se vuelve prosa", () => {
    expect(resolveUnknowns(["code", "unknown", "prose"])).toEqual(["code", "prose", "prose"]);
  });

  it("un unknown salta sobre otros unknown vecinos para encontrar el vecino resuelto", () => {
    expect(resolveUnknowns(["code", "unknown", "unknown", "code"])).toEqual([
      "code",
      "code",
      "code",
      "code",
    ]);
  });

  it("un unknown en el borde del arreglo (sin vecino de un lado) se vuelve prosa", () => {
    expect(resolveUnknowns(["unknown", "code"])).toEqual(["prose", "code"]);
  });

  it("una lista o encabezado corta la vecindad: no cuenta como código ni se salta", () => {
    expect(resolveUnknowns(["code", "list", "unknown", "code"])).toEqual([
      "code",
      "list",
      "prose",
      "code",
    ]);
  });
});

describe("fuseSplitBlocks — DEFECTO 4", () => {
  it("absorbe una línea corta tipo 'count: 3' entre dos bloques de código", () => {
    const units: Unit[] = [
      { type: "para", lines: ["const config = {"] },
      { type: "para", lines: ["count: 3"] },
      { type: "para", lines: ["};"] },
    ];
    const kinds = ["code", "prose", "code"] as const;
    expect(fuseSplitBlocks(units, [...kinds])).toEqual(["code", "code", "code"]);
  });

  it("no absorbe una oración tipo prosa aunque esté entre dos bloques de código", () => {
    const units: Unit[] = [
      { type: "para", lines: ["const config = {"] },
      { type: "para", lines: ["Esto se explica en el módulo siguiente."] },
      { type: "para", lines: ["};"] },
    ];
    const kinds = ["code", "prose", "code"] as const;
    expect(fuseSplitBlocks(units, [...kinds])).toEqual(["code", "prose", "code"]);
  });

  it("no absorbe una etiqueta en español aunque sea corta", () => {
    const units: Unit[] = [
      { type: "para", lines: ["const config = {"] },
      { type: "para", lines: ["Otra solución"] },
      { type: "para", lines: ["};"] },
    ];
    const kinds = ["code", "prose", "code"] as const;
    expect(fuseSplitBlocks(units, [...kinds])).toEqual(["code", "prose", "code"]);
  });

  it("no toca una unidad prosa que no está entre dos bloques de código", () => {
    const units: Unit[] = [
      { type: "para", lines: ["const config = {"] },
      { type: "para", lines: ["count: 3"] },
      { type: "para", lines: ["Cierre de la explicación."] },
    ];
    const kinds = ["code", "prose", "prose"] as const;
    expect(fuseSplitBlocks(units, [...kinds])).toEqual(["code", "prose", "prose"]);
  });
});
