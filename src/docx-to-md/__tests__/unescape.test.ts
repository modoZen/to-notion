import { describe, expect, it } from "vitest";
import { isAutolinkLine, stripAutolinks, unescapeAll, unescapeProse } from "../unescape.ts";

describe("stripAutolinks", () => {
  it("limpia un autoenlace http de pandoc", () => {
    expect(stripAutolinks("<https://example.com/x>")).toBe("https://example.com/x");
  });

  it("limpia un autoenlace escapado por pandoc (solo el '<' de apertura)", () => {
    expect(stripAutolinks("\\<https://example.com/x>")).toBe("https://example.com/x");
  });

  it("limpia un autoenlace mailto", () => {
    expect(stripAutolinks("<mailto:a@b.com>")).toBe("a@b.com");
  });

  it("no toca texto sin autoenlaces", () => {
    expect(stripAutolinks("texto normal")).toBe("texto normal");
  });
});

describe("isAutolinkLine", () => {
  it("detecta un autoenlace http al inicio de línea", () => {
    expect(isAutolinkLine("<https://example.com>")).toBe(true);
  });

  it("detecta un autoenlace escapado al inicio de línea", () => {
    expect(isAutolinkLine("\\<https://example.com>")).toBe(true);
  });

  it("detecta un autoenlace mailto", () => {
    expect(isAutolinkLine("<mailto:a@b.com>")).toBe(true);
  });

  it("ignora indentación previa al autoenlace", () => {
    expect(isAutolinkLine("   <https://example.com>")).toBe(true);
  });

  it("no confunde una etiqueta HTML cualquiera con un autoenlace", () => {
    expect(isAutolinkLine("<script>")).toBe(false);
  });

  it("no confunde texto normal", () => {
    expect(isAutolinkLine("esto es texto normal")).toBe(false);
  });
});

describe("unescapeAll", () => {
  it("DEFECTO 5: desescapa etiquetas HTML para que la clasificación matchee contra '<'", () => {
    expect(unescapeAll("\\<script\\>")).toBe("<script>");
  });

  it("DEFECTO 2: limpia autoenlaces igual que stripAutolinks", () => {
    expect(unescapeAll("<https://example.com>")).toBe("https://example.com");
  });

  it("convierte '...' escapado en elipsis unicode", () => {
    expect(unescapeAll("Espera\\...")).toBe("Espera…");
  });

  it("desescapa cualquier carácter con backslash", () => {
    expect(unescapeAll("\\*no es negrita\\*")).toBe("*no es negrita*");
  });

  it("desescapa guion bajo y backtick", () => {
    expect(unescapeAll("mi\\_variable y \\`codigo\\`")).toBe("mi_variable y `codigo`");
  });
});

describe("unescapeProse", () => {
  it("limpia autoenlaces igual que en unescapeAll", () => {
    expect(unescapeProse("<https://example.com>")).toBe("https://example.com");
  });

  it("convierte '...' escapado en elipsis unicode", () => {
    expect(unescapeProse("Espera\\...")).toBe("Espera…");
  });

  it("desescapa puntuación sin significado markdown", () => {
    expect(unescapeProse("precio\\: 100\\, gracias\\!")).toBe("precio: 100, gracias!");
  });

  it("mantiene escapados los marcadores con significado markdown (*, _, `, #, \\\\)", () => {
    expect(unescapeProse("\\*no es negrita\\* y \\`no es codigo\\` y \\# no es h1")).toBe(
      "\\*no es negrita\\* y \\`no es codigo\\` y \\# no es h1",
    );
  });

  it("mueve el espacio de cierre de negrita fuera del marcador (Word cierra después del espacio)", () => {
    expect(unescapeProse("**Diferencia **entre esto y aquello")).toBe(
      "**Diferencia** entre esto y aquello",
    );
  });

  it("mueve el espacio de apertura de negrita fuera del marcador", () => {
    expect(unescapeProse("esto y** aquello**")).toBe("esto y **aquello**");
  });

  it("reemplaza NBSP por un espacio normal", () => {
    expect(unescapeProse("texto\u00a0con\u00a0nbsp")).toBe("texto con nbsp");
  });
});
