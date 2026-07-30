import { describe, expect, it } from "vitest";
import { safeLang } from "../lang.ts";

describe("safeLang", () => {
  it("lenguaje soportado pasa igual", () => {
    expect(safeLang("javascript")).toBe("javascript");
  });

  it("lenguaje no soportado cae a 'plain text'", () => {
    expect(safeLang("cobol")).toBe("plain text");
  });

  it("normaliza mayúsculas y espacios", () => {
    expect(safeLang("  JavaScript  ")).toBe("javascript");
  });

  it("sin lenguaje (fence sin lang) cae a 'plain text'", () => {
    expect(safeLang("")).toBe("plain text");
    expect(safeLang(undefined)).toBe("plain text");
  });
});
