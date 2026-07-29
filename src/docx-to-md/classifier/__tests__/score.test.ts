import { describe, expect, it } from "vitest";
import {
  ACCENTED,
  API_TOKENS,
  HARD_SYNTAX,
  KEYWORD_START,
  SHELL_START,
  classifyLine,
  isFilePathLabel,
  isGlossArg,
  isSpanishLabel,
  mixedProse,
  stripWholeLineEmphasis,
  wordCount,
} from "../score.ts";

describe("regex base", () => {
  it("KEYWORD_START matchea palabras clave de JS/TS al inicio de línea", () => {
    expect(KEYWORD_START.test("const x = 1")).toBe(true);
    expect(KEYWORD_START.test("function foo() {")).toBe(true);
    expect(KEYWORD_START.test("interface Foo {")).toBe(true);
    expect(KEYWORD_START.test("Costa Rica es un país")).toBe(false);
  });

  it("SHELL_START matchea comandos de terminal con argumento", () => {
    expect(SHELL_START.test("npm install foo")).toBe(true);
    expect(SHELL_START.test("git commit -m x")).toBe(true);
    expect(SHELL_START.test("npm")).toBe(false);
  });

  it("API_TOKENS matchea APIs conocidas del navegador/Node", () => {
    expect(API_TOKENS.test("console.log(x)")).toBe(true);
    expect(API_TOKENS.test("document.getElementById('x')")).toBe(true);
    expect(API_TOKENS.test("esto no tiene ninguna API")).toBe(false);
  });

  it("HARD_SYNTAX matchea sintaxis inequívoca de código", () => {
    expect(HARD_SYNTAX.test("const f = () => x")).toBe(true);
    expect(HARD_SYNTAX.test("if (x) {")).toBe(true);
    expect(HARD_SYNTAX.test("x = 1;")).toBe(true);
    expect(HARD_SYNTAX.test("Esto es una oración cualquiera")).toBe(false);
  });

  it("ACCENTED detecta tildes y signos de apertura del español", () => {
    expect(ACCENTED.test("explicación")).toBe(true);
    expect(ACCENTED.test("¿cómo?")).toBe(true);
    expect(ACCENTED.test("explanation")).toBe(false);
  });
});

describe("wordCount", () => {
  it("cuenta palabras separadas por espacios", () => {
    expect(wordCount("una linea de texto")).toBe(4);
  });

  it("trata NBSP como separador de palabras", () => {
    expect(wordCount("una linea con nbsp")).toBe(4);
  });

  it("ignora espacios repetidos y extremos", () => {
    expect(wordCount("  hola   mundo  ")).toBe(2);
  });
});

describe("isGlossArg", () => {
  it("una palabra sola entre paréntesis es una glosa", () => {
    expect(isGlossArg("SRP")).toBe(true);
    expect(isGlossArg("Abstract Syntax Tree")).toBe(true);
  });

  it("un string, número o expresión con punto es un argumento real", () => {
    expect(isGlossArg("'video'")).toBe(false);
    expect(isGlossArg("1,3")).toBe(false);
    expect(isGlossArg("document.body")).toBe(false);
  });

  it("un argumento vacío no es glosa", () => {
    expect(isGlossArg("")).toBe(false);
  });
});

describe("classifyLine — motor de puntaje", () => {
  it("clasifica declaraciones de variable como código", () => {
    expect(classifyLine("const x = 1;")).toBe("code");
  });

  it("clasifica una definición de función como código", () => {
    expect(classifyLine("function suma(a, b) {")).toBe("code");
  });

  it("clasifica un comando de shell como código", () => {
    expect(classifyLine("npm install express")).toBe("code");
  });

  it("clasifica una llamada a una API conocida como código", () => {
    expect(classifyLine("console.log('hola mundo')")).toBe("code");
  });

  it("clasifica un cierre de bloque con llave como código", () => {
    expect(classifyLine("}")).toBe("code");
  });

  it("clasifica una arrow function como código", () => {
    expect(classifyLine("const suma = (a, b) => a + b;")).toBe("code");
  });

  it("una línea vacía es unknown", () => {
    expect(classifyLine("   ")).toBe("unknown");
  });
});

describe("classifyLine — DEFECTO 1: URL suelta nunca es código", () => {
  it("un autoenlace de pandoc es prosa", () => {
    expect(classifyLine("<https://example.com>")).toBe("prose");
  });

  it("una URL suelta sin marcado de autoenlace también es prosa", () => {
    expect(classifyLine("https://example.com/x")).toBe("prose");
  });
});

describe("classifyLine — entradas de índice", () => {
  it("una entrada de índice anidada es prosa", () => {
    expect(classifyLine("[Título [6](#modulo-6)](#modulo-6)")).toBe("prose");
  });

  it("una línea compuesta solo por enlaces markdown es prosa", () => {
    expect(classifyLine("[Uno](#a) [Dos](#b)")).toBe("prose");
  });
});

describe("classifyLine — sangría NBSP (código pegado sin formato)", () => {
  it("una línea con sangría de NBSP es código, aunque el contenido sea corto", () => {
    expect(classifyLine("    return x;")).toBe("code");
  });
});

describe("classifyLine — DEFECTO 5: etiquetas HTML evaluadas ya desescapadas", () => {
  it("una etiqueta HTML escapada por pandoc se reconoce como código", () => {
    expect(classifyLine("\\<script\\>")).toBe("code");
  });

  it("un DOCTYPE es código", () => {
    expect(classifyLine("<!DOCTYPE html>")).toBe("code");
  });
});

describe("classifyLine — cierres de bloque sueltos", () => {
  it("un cierre de llave solo es código", () => {
    expect(classifyLine("}")).toBe("code");
  });

  it("una apertura de llave sola es código", () => {
    expect(classifyLine("{")).toBe("code");
  });
});

describe("classifyLine — DEFECTO 3: freno de prosa", () => {
  it("una oración larga con conectores del español y sin sintaxis de código es prosa", () => {
    expect(
      classifyLine("En este módulo vamos a aprender los conceptos básicos de JavaScript"),
    ).toBe("prose");
  });

  it("la misma cantidad de palabras pero terminando en punto y coma no activa el freno", () => {
    expect(classifyLine("const resultado = calcularElValorTotalDeLaCompra(carrito);")).toBe(
      "code",
    );
  });
});

describe("classifyLine — negrita como sentencia", () => {
  it("una negrita que es solo un identificador es un rótulo de sección (prosa)", () => {
    expect(classifyLine("**Object.create**")).toBe("prose");
  });

  it("una negrita con sintaxis de sentencia real es código", () => {
    expect(classifyLine("**element.onclick = function(){}**")).toBe("code");
  });

  it("una negrita con dos puntos de subtítulo es prosa", () => {
    expect(classifyLine("**Parcel:**")).toBe("prose");
  });
});

describe("mixedProse — prosa que cita código", () => {
  it("detecta una oración en español con fragmentos de código mezclados", () => {
    expect(
      mixedProse(
        "La diferencia es que element.onclick hace lo mismo que element.addEventListener con distinta sintaxis",
      ),
    ).toBe(true);
  });

  it("no marca código real como mixedProse", () => {
    expect(mixedProse("const x = document.querySelector('.foo');")).toBe(false);
  });

  it("classifyLine devuelve prosa para una línea mixedProse", () => {
    expect(
      classifyLine(
        "La diferencia es que element.onclick hace lo mismo que element.addEventListener con distinta sintaxis",
      ),
    ).toBe("prose");
  });
});

describe("isFilePathLabel — rótulo de archivo suelto", () => {
  it("una ruta con carpetas es un rótulo de archivo", () => {
    expect(isFilePathLabel("Assets/plugins/Ads/Ads.json")).toBe(true);
  });

  it("un nombre de archivo con extensión conocida es un rótulo de archivo", () => {
    expect(isFilePathLabel("package.json")).toBe(true);
  });

  it("una URL no es un rótulo de archivo", () => {
    expect(isFilePathLabel("https://example.com/package.json")).toBe(false);
  });

  it("una línea con espacios no es un rótulo de archivo", () => {
    expect(isFilePathLabel("esto tiene espacios.json")).toBe(false);
  });

  it("classifyLine devuelve prosa para un rótulo de archivo suelto", () => {
    expect(classifyLine("Assets/plugins/Ads/Ads.json")).toBe("prose");
  });
});

describe("isSpanishLabel — etiqueta suelta en español", () => {
  it("una etiqueta corta sin sintaxis de código es prosa", () => {
    expect(isSpanishLabel("Otra solución")).toBe(true);
    expect(isSpanishLabel("Explicación extra")).toBe(true);
  });

  it("una frase corta con dos puntos también es prosa", () => {
    expect(isSpanishLabel("Si en nuestro código tenemos:")).toBe(true);
  });

  it("una sola palabra no cuenta como etiqueta", () => {
    expect(isSpanishLabel("Nota")).toBe(false);
  });

  it("un nombre de archivo mencionado en la frase no rompe la detección", () => {
    expect(isSpanishLabel("Creamos el archivo sw.js")).toBe(true);
  });

  it("classifyLine devuelve prosa para una etiqueta suelta en español", () => {
    expect(classifyLine("Otra solución")).toBe("prose");
  });
});

describe("classifyLine — comentario de cola con //", () => {
  it("un `;` tapado por un comentario de cola igual cuenta para el puntaje de código", () => {
    expect(classifyLine('x = [10, "hello"]; // Error')).toBe("code");
  });

  it("no confunde un comentario de cola con una URL dentro del string", () => {
    expect(classifyLine('const url = "https://example.com/a/b";')).toBe("code");
  });
});

describe("stripWholeLineEmphasis", () => {
  it("quita los asteriscos que envuelven toda la línea", () => {
    expect(stripWholeLineEmphasis("**foo()**")).toBe("foo()");
  });

  it("no toca una línea que no está envuelta completa en negrita", () => {
    expect(stripWholeLineEmphasis("**foo** y bar")).toBe("**foo** y bar");
  });
});

describe("classifyLine — frase larga con acentos y punto final", () => {
  it("una frase de 6+ palabras con tildes terminada en punto es prosa", () => {
    expect(classifyLine("Acá vamos a repasar la explicación completa del módulo.")).toBe("prose");
  });
});
