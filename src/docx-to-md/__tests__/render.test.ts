import { describe, expect, it } from "vitest";
import type { ClassifiedKind, Unit } from "../types.ts";
import {
  imageMarker,
  joinDanglingAssignments,
  renderModule,
  splitAtDocumentEnd,
  stripWholeLineEmphasis,
  unitCodeLines,
} from "../render.ts";

describe("unitCodeLines", () => {
  it("desescapa, quita negrita envolvente y NBSP, y recorta espacios finales", () => {
    const unit: Unit = { type: "para", lines: ["**const x = 1;**  ", "otra\\_linea"] };
    expect(unitCodeLines(unit)).toEqual(["const x = 1;", "otra_linea"]);
  });

  it("en una cita, quita el prefijo '>' de cada línea", () => {
    const unit: Unit = { type: "quote", lines: ["> const x = 1;", "> const y = 2;"] };
    expect(unitCodeLines(unit)).toEqual(["const x = 1;", "const y = 2;"]);
  });

  it("en una cita, descarta el espaciado artificial de Word (mayoría de líneas en blanco)", () => {
    const unit: Unit = {
      type: "quote",
      lines: ["> const a = 1;", ">", "> const b = 2;", ">"],
    };
    expect(unitCodeLines(unit)).toEqual(["const a = 1;", "const b = 2;"]);
  });
});

describe("joinDanglingAssignments", () => {
  it("une una asignación partida por Word en dos párrafos", () => {
    const lines = ['const url =', '"https://example.com/path";'];
    expect(joinDanglingAssignments(lines)).toEqual([
      'const url = "https://example.com/path";',
    ]);
  });

  it("no une una comparación (==) con la línea siguiente", () => {
    const lines = ["if (x ==", "1) {}"];
    expect(joinDanglingAssignments(lines)).toEqual(["if (x ==", "1) {}"]);
  });

  it("no une si la línea siguiente está vacía", () => {
    const lines = ["const url =", ""];
    expect(joinDanglingAssignments(lines)).toEqual(["const url =", ""]);
  });
});

describe("splitAtDocumentEnd", () => {
  it("parte el código en dos al encontrar </html>", () => {
    const code = "<html>\n<body></body>\n</html>\nconst x = 1;";
    expect(splitAtDocumentEnd(code)).toEqual(["<html>\n<body></body>\n</html>", "const x = 1;"]);
  });

  it("no parte nada si no hay </html>", () => {
    const code = "const x = 1;\nconst y = 2;";
    expect(splitAtDocumentEnd(code)).toEqual([code]);
  });

  it("no parte nada si </html> es la última línea", () => {
    const code = "<html>\n</html>";
    expect(splitAtDocumentEnd(code)).toEqual([code]);
  });
});

describe("imageMarker", () => {
  it("genera un marcador estable a partir del basename", () => {
    expect(imageMarker("./media/image110.png")).toBe("![](image110.png)");
  });
});

describe("stripWholeLineEmphasis (reexportado desde el clasificador)", () => {
  it("quita los asteriscos que envuelven toda la línea", () => {
    expect(stripWholeLineEmphasis("**foo()**")).toBe("foo()");
  });
});

describe("renderModule", () => {
  it("emite heading, lista, cita, imagen y párrafo, y cuenta las estadísticas", () => {
    const units: Unit[] = [
      { type: "heading", level: 2, text: "Introducción" },
      { type: "list", lines: ["- uno", "- dos"] },
      { type: "quote", lines: ["> una cita"] },
      { type: "image", src: "./media/image1.png" },
      { type: "para", lines: ["Un párrafo cualquiera de prosa."] },
    ];
    const kinds: ClassifiedKind[] = ["heading", "list", "quote", "image", "prose"];
    const { text, stats } = renderModule(units, kinds, "Módulo de prueba");

    expect(text).toBe(
      [
        "## Introducción",
        "",
        "- uno",
        "- dos",
        "",
        "> una cita",
        "",
        "![](image1.png)",
        "",
        "Un párrafo cualquiera de prosa.",
        "",
      ].join("\n"),
    );
    expect(stats).toEqual({ code: 0, images: 1, headings: 1, lists: 1, paras: 1, quotes: 1 });
  });

  it("preserva un fence tal cual, sin pasar por el detector de lenguaje", () => {
    const units: Unit[] = [{ type: "fence", lines: ["```txt", "hola", "```"] }];
    const kinds: ClassifiedKind[] = ["fence"];
    const { text } = renderModule(units, kinds, "Módulo de prueba");
    expect(text).toBe("```txt\nhola\n```\n");
  });

  it("agrupa unidades de código consecutivas y detecta el lenguaje del bloque", () => {
    const units: Unit[] = [
      { type: "para", lines: ["function suma(a, b) {"] },
      { type: "para", lines: ["return a + b;"] },
      { type: "para", lines: ["}"] },
    ];
    const kinds: ClassifiedKind[] = ["code", "code", "code"];
    const { text, stats } = renderModule(units, kinds, "Módulo de prueba");

    expect(text).toBe("```javascript\nfunction suma(a, b) {\nreturn a + b;\n}\n```\n");
    expect(stats.code).toBe(1);
  });

  it("parte dos raíces JSON pegadas en dos fences separados", () => {
    const units: Unit[] = [
      { type: "para", lines: ['{ "a": 1 }'] },
      { type: "para", lines: ['{ "b": 2 }'] },
    ];
    const kinds: ClassifiedKind[] = ["code", "code"];
    const { text, stats } = renderModule(units, kinds, "Módulo de prueba");

    expect(text).toBe('```json\n{ "a": 1 }\n```\n\n```json\n{ "b": 2 }\n```\n');
    expect(stats.code).toBe(2);
  });

  it("une una asignación partida y separa el código después de </html> en dos fences", () => {
    const units: Unit[] = [
      { type: "para", lines: ["<html>", "<body></body>", "</html>", "const x = 1;"] },
    ];
    const kinds: ClassifiedKind[] = ["code"];
    const { text, stats } = renderModule(units, kinds, "Módulo de prueba");

    expect(text).toBe(
      "```html\n<html>\n<body></body>\n</html>\n```\n\n```javascript\nconst x = 1;\n```\n",
    );
    expect(stats.code).toBe(2);
  });

  it("colapsa tres o más líneas en blanco seguidas a una sola línea en blanco", () => {
    const units: Unit[] = [
      { type: "heading", level: 1, text: "Título" },
      { type: "fence", lines: ["```txt", "", "", "```"] },
    ];
    const kinds: ClassifiedKind[] = ["heading", "fence"];
    const { text } = renderModule(units, kinds, "Módulo de prueba");
    expect(text).not.toMatch(/\n{3,}/);
  });
});
