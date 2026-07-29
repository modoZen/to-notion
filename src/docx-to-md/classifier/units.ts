import { unescapeAll } from "../unescape.ts";
import type { ClassifiedKind, Unit } from "../types.ts";
import { classifyLine, isFilePathLabel, isSpanishLabel, mixedProse, wordCount } from "./score.ts";

// ===========================================================================
// 5. RESOLUCIÓN DE CONTEXTO Y FUSIÓN
// ===========================================================================

/** Una unidad `para` puede tener varias líneas; decide por mayoría con sesgo. */
export function classifyUnit(unit: Unit): ClassifiedKind {
  // Word mete algunos listados dentro de una cita. Pandoc los entrega como
  // blockquote y hasta ahora nunca podían ser código, así que el CSS salía
  // como texto citado en vez de bloque. Se decide por el contenido, sin el
  // prefijo `>`.
  if (unit.type === "quote") {
    const votes = (unit.lines ?? []).map((l) => classifyLine(l.replace(/^\s*>\s?/, "")));
    const c = votes.filter((v) => v === "code").length;
    const p = votes.filter((v) => v === "prose").length;
    return c > 0 && c >= p ? "code" : "quote";
  }
  if (unit.type !== "para") return unit.type;
  const votes = (unit.lines ?? []).map(classifyLine);
  if (votes.includes("code") && !votes.includes("prose")) return "code";
  if (votes.includes("prose") && !votes.includes("code")) return "prose";
  const c = votes.filter((v) => v === "code").length;
  const p = votes.filter((v) => v === "prose").length;
  if (c > p) return "code";
  if (p > c) return "prose";
  return "unknown";
}

/**
 * Los `unknown` se deciden por vecindad: si están rodeados de código, son
 * código. Si no, prosa. Esto es lo que salva las líneas neutras (`}`,
 * `count: 3`, cadenas sueltas) que caen en medio de un bloque.
 */
export function resolveUnknowns(kinds: ClassifiedKind[]): ClassifiedKind[] {
  const out = kinds.slice();

  // Un `unknown` solo se vuelve código si sus vecinos INMEDIATOS resueltos son
  // código, saltando únicamente otros `unknown`. Cualquier otra cosa
  // (encabezado, lista, cita, imagen) corta la vecindad: si en medio hay una
  // viñeta, los dos bloques de código no son el mismo bloque.
  const neighbor = (i: number, step: number): ClassifiedKind | null => {
    for (let j = i + step; j >= 0 && j < out.length; j += step) {
      if (out[j] === "unknown") continue;
      return out[j];
    }
    return null;
  };

  for (let i = 0; i < out.length; i++) {
    if (kinds[i] !== "unknown") continue;
    const prev = neighbor(i, -1);
    const next = neighbor(i, +1);
    out[i] = prev === "code" && next === "code" ? "code" : "prose";
  }
  return out;
}

/**
 * DEFECTO 4: un bloque partido en tres por una sola línea corta tipo `count: 3`
 * que se clasificó como prosa. Si entre dos bloques de código hay exactamente
 * una unidad `prose` corta, sin puntuación de oración, se absorbe.
 */
export function fuseSplitBlocks(units: Unit[], kinds: ClassifiedKind[]): ClassifiedKind[] {
  const out = kinds.slice();
  for (let i = 1; i < units.length - 1; i++) {
    if (out[i] !== "prose" || units[i].type !== "para") continue;
    if (out[i - 1] !== "code" || out[i + 1] !== "code") continue;
    const text = unescapeAll((units[i].lines ?? []).join(" ")).trim();
    // Una etiqueta en español no se absorbe NUNCA, por corta que sea y aunque
    // tenga código a los dos lados. Es texto del Word, no una línea de código
    // suelta como el `count: 3` que esta fusión existe para reunir.
    if (isSpanishLabel(text) || mixedProse(text) || isFilePathLabel(text)) continue;
    const wc = wordCount(text);
    const sentenceLike = /[.!?]\s*$/.test(text) && wc >= 5;
    if (wc <= 6 && !sentenceLike) out[i] = "code";
  }
  return out;
}
