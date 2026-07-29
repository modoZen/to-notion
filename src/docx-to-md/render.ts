import { basename } from "node:path";
import { stripWholeLineEmphasis } from "./classifier/score.ts";
import { unescapeAll, unescapeProse } from "./unescape.ts";
import { detectLanguage } from "./language.ts";
import type { ClassifiedKind, ModuleStats, Unit } from "./types.ts";

// ===========================================================================
// 7. EMISIÓN
// ===========================================================================

export { stripWholeLineEmphasis };

/** Líneas de una unidad listas para meter en un fence. */
export function unitCodeLines(unit: Unit): string[] {
  let lines = unit.lines ?? [];
  if (unit.type === "quote") {
    lines = lines.map((l) => l.replace(/^\s*>\s?/, ""));
    // Word mete un párrafo por línea dentro de la cita y pandoc los separa
    // con un `>` vacío, así que el listado sale con un blanco entre cada
    // línea. Si más de la mitad son blancos es espaciado del Word, no líneas
    // en blanco que el autor puso a propósito.
    const blanks = lines.filter((l) => l.trim() === "").length;
    if (blanks > 0 && blanks * 3 >= lines.length) lines = lines.filter((l) => l.trim() !== "");
  }
  return lines.map((l) =>
    stripWholeLineEmphasis(unescapeAll(l))
      .replace(/\u00a0/g, " ")
      .replace(/\s+$/, ""),
  );
}

/**
 * Word parte algunas asignaciones largas en dos párrafos: `const url =` en uno
 * y la URL en el siguiente. Pandoc los entrega como líneas distintas y el
 * bloque sale cortado a la mitad. Se vuelven a unir.
 *
 * Solo aplica al `=` de asignación: se excluye `==`, `!=`, `<=`, `+=` y demás,
 * para no pegar una comparación con la línea de abajo.
 */
export function joinDanglingAssignments(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /[^=!<>+\-*/%&|^]=\s*$/.test(prev) && l.trim() !== "") {
      out[out.length - 1] = prev.replace(/\s*$/, " ") + l.trim();
    } else {
      out.push(l);
    }
  }
  return out;
}

/**
 * Un `</html>` cierra el documento. Lo que venga después es otro archivo y
 * casi siempre otro lenguaje: en este curso, el HTML de la página seguido
 * del TypeScript que la acompaña, pegados sin separador. Antes salían en un
 * solo fence y el detector etiquetaba los dos con el lenguaje que dominara
 * en número de líneas.
 */
export function splitAtDocumentEnd(code: string): string[] {
  const lines = code.split("\n");
  const idx = lines.findIndex((l) => /^\s*<\/html>\s*$/i.test(l));
  if (idx === -1 || idx === lines.length - 1) return [code];
  return [
    lines.slice(0, idx + 1).join("\n"),
    ...splitAtDocumentEnd(lines.slice(idx + 1).join("\n")),
  ];
}

export function imageMarker(src: string): string {
  // ./media/image110.png  ->  ![](image110.png)   <- token estable, no tocar
  return `![](${basename(src)})`;
}

export interface RenderedModule {
  text: string;
  stats: ModuleStats;
}

export function renderModule(
  units: Unit[],
  kinds: ClassifiedKind[],
  moduleTitle: string,
): RenderedModule {
  const out: string[] = [];
  const stats: ModuleStats = { code: 0, images: 0, headings: 0, lists: 0, paras: 0, quotes: 0 };
  let i = 0;

  while (i < units.length) {
    const u = units[i];
    const k = kinds[i];

    if (k === "code") {
      const start = i;
      const segments: string[][] = [];
      let buf: string[] = [];
      let depth = 0;

      while (i < units.length && kinds[i] === "code") {
        const lines = unitCodeLines(units[i]);
        const firstTrim = (lines[0] || "").trim();

        // Dos JSON pegados: `}` de uno y `{` del siguiente sin nada en medio.
        // Se parten cuando las llaves ya cerraron y arranca una raíz nueva.
        // Solo se aplica si lo acumulado ES una raíz JSON, para no cortar
        // JavaScript con varias sentencias de nivel superior.
        const bufIsJsonRoot = buf.length > 0 && /^[{[]/.test(buf[0].trim());
        if (bufIsJsonRoot && depth === 0 && /^[{[]/.test(firstTrim)) {
          segments.push(buf);
          buf = [];
        }

        for (const l of lines) {
          buf.push(l);
          for (const ch of l) {
            if (ch === "{" || ch === "[") depth++;
            else if (ch === "}" || ch === "]") depth--;
          }
        }
        if (depth < 0) depth = 0;
        i++;
      }
      if (buf.length) segments.push(buf);
      // DEFECTO 9: si por lo que sea no se consumió nada, avanzar igual.
      if (i === start) i++;

      for (const seg of segments) {
        const whole = joinDanglingAssignments(seg).join("\n").replace(/^\n+|\n+$/g, "");
        for (const code of splitAtDocumentEnd(whole)) {
          if (code.trim() === "") continue;
          const lang = detectLanguage(code, moduleTitle);
          out.push("```" + lang, code, "```", "");
          stats.code++;
        }
      }
      continue;
    }

    switch (u.type) {
      case "heading":
        out.push("#".repeat(Math.min(u.level ?? 1, 6)) + " " + u.text, "");
        stats.headings++;
        break;
      case "image":
        out.push(imageMarker(u.src ?? ""), "");
        stats.images++;
        break;
      case "list":
        out.push(...(u.lines ?? []).map((l) => unescapeProse(l).replace(/\s+$/, "")), "");
        stats.lists++;
        break;
      case "quote":
        out.push(...(u.lines ?? []).map((l) => unescapeProse(l).replace(/\s+$/, "")), "");
        stats.quotes++;
        break;
      case "fence":
        out.push(...(u.lines ?? []), "");
        break;
      default:
        out.push(...(u.lines ?? []).map((l) => unescapeProse(l).replace(/\s+$/, "")), "");
        stats.paras++;
    }
    i++;
  }

  // Colapsar líneas en blanco repetidas.
  const text =
    out
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s+$/, "") + "\n";
  return { text, stats };
}
