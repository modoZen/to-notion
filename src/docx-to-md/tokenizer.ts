import { unescapeProse } from "./unescape.ts";
import type { Unit } from "./types.ts";

// ===========================================================================
// TOKENIZADO: markdown crudo -> unidades
// ===========================================================================
//
// Con --wrap=none cada párrafo del .docx es UNA línea. Las unidades son
// grupos de líneas no vacías consecutivas.
//
// tipos: heading | image | list | quote | para | fence
//

const RE_HEADING = /^(#{1,6})\s+(.*?)(?:\s*\{[^}]*\})?\s*$/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+/;
const RE_QUOTE = /^\s*>\s?/;

// Una referencia de imagen de pandoc, en cualquier posición de la línea:
//   ![alt](./media/image57.png){width="3.4in" height="2.0in"}
// Puede venir varias veces en la misma línea (imágenes lado a lado en Word)
// y puede venir pegada a texto. Por eso NO se ancla al inicio ni al final.
const RE_IMAGE_ANY = /!\[[^\]]*\]\(([^)\s]*media\/[^)\s]+)\)(?:\{[^}]*\})?/g;

export function tokenize(rawMd: string): Unit[] {
  const lines = rawMd.split(/\r?\n/);
  const units: Unit[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // --- DEFECTO 7: bloques ```{=html} que pandoc usa como separador ---
    if (/^```\{=html\}\s*$/.test(line)) {
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) j++;
      i = j + 1; // DEFECTO 9: avanzar SIEMPRE, aunque el bloque venga vacío
      continue;
    }
    // Cualquier otro fence que pandoc haya emitido: se respeta tal cual.
    if (/^```/.test(line)) {
      const fence = [line];
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) fence.push(lines[j++]);
      if (j < lines.length) fence.push(lines[j]);
      units.push({ type: "fence", lines: fence });
      i = j + 1;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Agrupar líneas no vacías consecutivas en una unidad.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^```/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    units.push(...classifyStructure(buf));
  }
  return units;
}

/**
 * Convierte un grupo de líneas en una o varias unidades.
 *
 * Las imágenes se sacan SIEMPRE a unidades propias, vengan solas, pegadas a
 * texto o varias en la misma línea (Word pone imágenes lado a lado en un solo
 * párrafo — de ahí las "huérfanas" que se perdían). El texto que las rodea se
 * conserva como unidad aparte, en el mismo orden.
 */
export function classifyStructure(buf: string[]): Unit[] {
  const first = buf[0];

  const h = first.match(RE_HEADING);
  if (h && buf.length === 1) {
    return [{ type: "heading", level: h[1].length, text: unescapeProse(h[2]).trim() }];
  }

  const kind: "list" | "quote" | "para" = RE_LIST.test(first)
    ? "list"
    : RE_QUOTE.test(first)
      ? "quote"
      : "para";
  const out: Unit[] = [];
  let pending: string[] = [];

  const flush = () => {
    if (pending.some((l) => l.trim() !== "")) out.push({ type: kind, lines: pending.slice() });
    pending = [];
  };

  for (const line of buf) {
    RE_IMAGE_ANY.lastIndex = 0;
    if (!RE_IMAGE_ANY.test(line)) {
      pending.push(line);
      continue;
    }

    RE_IMAGE_ANY.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_IMAGE_ANY.exec(line)) !== null) {
      const before = line.slice(last, m.index);
      if (before.trim() !== "") {
        pending.push(before);
        flush();
      } else {
        flush();
      }
      out.push({ type: "image", src: m[1] });
      last = m.index + m[0].length;
    }
    const after = line.slice(last);
    if (after.trim() !== "") pending.push(after);
  }
  flush();
  return out;
}
