import { describe, expect, it } from "vitest";
import { detectLanguage } from "../language.ts";

describe("detectLanguage", () => {
  it("detecta html cuando la mayoría de las líneas son etiquetas", () => {
    const code = "<div>\n  <p>hola</p>\n</div>";
    expect(detectLanguage(code, "Módulo cualquiera")).toBe("html");
  });

  it("detecta html por DOCTYPE aunque el resto no sea mayoría de etiquetas", () => {
    const code = '<!DOCTYPE html>\n<html lang="es">';
    expect(detectLanguage(code, "Módulo cualquiera")).toBe("html");
  });

  it("detecta bash cuando todas las líneas son comandos de terminal", () => {
    const code = "npm install\nnpm run build";
    expect(detectLanguage(code, "Módulo cualquiera")).toBe("bash");
  });

  it("detecta json cuando el cuerpo es un objeto de claves sin sintaxis de JS", () => {
    const code = '{\n  "name": "foo",\n  "version": "1.0.0"\n}';
    expect(detectLanguage(code, "Módulo cualquiera")).toBe("json");
  });

  it("detecta css cuando la mayoría de las líneas son selectores o declaraciones", () => {
    const code = ".foo {\n  color: red;\n  margin: 0;\n}";
    expect(detectLanguage(code, "Módulo cualquiera")).toBe("css");
  });

  it("detecta typescript por sintaxis fuerte (interface, enum, etc.)", () => {
    const code = "interface Foo {\n  bar: string;\n}";
    expect(detectLanguage(code, "Módulo cualquiera")).toBe("typescript");
  });

  it("detecta typescript por una anotación de tipo real", () => {
    const code = "const nombre: string = 'Ada';";
    expect(detectLanguage(code, "Módulo cualquiera")).toBe("typescript");
  });

  it("no confunde un ternario con una anotación de tipo de TypeScript", () => {
    const code = "a.paused ? this.play() : this.pause();";
    expect(detectLanguage(code, "Módulo cualquiera")).toBe("javascript");
  });

  it("javascript es el lenguaje por defecto", () => {
    const code = "function suma(a, b) {\n  return a + b;\n}";
    expect(detectLanguage(code, "Módulo cualquiera")).toBe("javascript");
  });

  it("usa el título del módulo como sesgo hacia typescript cuando no hay otra señal", () => {
    const code = "function suma(a, b) {\n  return a + b;\n}";
    expect(detectLanguage(code, "Introducción a TypeScript")).toBe("typescript");
  });
});
