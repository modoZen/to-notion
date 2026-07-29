import type { Unit } from "./types.ts";

// ===========================================================================
// 8. ORQUESTACIÓN — división en módulos y detección del índice
// ===========================================================================

export function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "modulo"
  );
}

export interface SplitModule {
  title: string;
  units: Unit[];
}

/** Divide las unidades en módulos por cada encabezado H1. */
export function splitModules(units: Unit[]): SplitModule[] {
  const mods: SplitModule[] = [];
  let cur: SplitModule | null = null;
  for (const u of units) {
    if (u.type === "heading" && u.level === 1) {
      cur = { title: u.text ?? "", units: [] };
      mods.push(cur);
      continue;
    }
    if (!cur) continue; // preámbulo antes del primer H1: se descarta
    cur.units.push(u);
  }
  return mods;
}

/**
 * Un índice/tabla de contenido se identifica por el título o porque casi
 * todo su contenido son enlaces a anclas internas, no por su posición.
 */
export function isIndexModule(mod: SplitModule): boolean {
  const anchors = mod.units.filter(
    (u) => u.lines && u.lines.some((l) => /\]\(#/.test(l)),
  ).length;
  return (
    /^(contenido|índice|indice|tabla de contenido)/i.test(mod.title) ||
    anchors >= Math.max(3, mod.units.length * 0.6)
  );
}

/** Quita el primer módulo si es un índice/tabla de contenido. */
export function removeIndexModule(modules: SplitModule[]): SplitModule[] {
  if (!modules.length) return modules;
  const [first, ...rest] = modules;
  return isIndexModule(first) ? rest : modules;
}
