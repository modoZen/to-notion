// ===========================================================================
// 6. LENGUAJE DEL BLOQUE (DEFECTO 8)
// ===========================================================================

export type DetectedLanguage = "html" | "bash" | "json" | "css" | "typescript" | "javascript";

export function detectLanguage(codeText: string, moduleTitle: string): DetectedLanguage {
  const lines = codeText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const body = lines.join("\n");
  const n = lines.length || 1;

  const htmlish = lines.filter((l) => /^<\/?[a-zA-Z!]/.test(l)).length;
  if (/^<!DOCTYPE\s+html/i.test(body) || htmlish / n >= 0.6) return "html";

  if (
    /^\s*(npm|npx|yarn|pnpm|git|tsc|node|cd|rm|mkdir|sudo|curl)\b/.test(lines[0] || "") &&
    lines.every((l) =>
      /^(npm|npx|yarn|pnpm|git|tsc|node|cd|rm|ls|mkdir|touch|cp|mv|curl|code|sudo|#|\$)/.test(l),
    )
  ) {
    return "bash";
  }

  const looksJson =
    /^[{[]/.test(body) &&
    /"[^"]+"\s*:/.test(body) &&
    !/\b(function|const|let|var|=>|return)\b/.test(body);
  if (looksJson) return "json";

  const cssish = lines.filter((l) => /^[.#]?[\w-]+\s*\{$|^[\w-]+\s*:\s*[^;]+;$/.test(l)).length;
  if (cssish / n >= 0.7 && !/\b(function|const|let|var|=>)\b/.test(body)) return "css";

  // TypeScript: hay que pedir una anotación de tipo real. Un ternario
  // (`a.paused ? this.play() : this.pause()`) también produce `):` y hacía
  // que JavaScript plano se etiquetara como TypeScript.
  const TYPE =
    "(?:string|number|boolean|any|void|never|unknown|object|symbol|bigint|Array<|Promise<|[A-Z]\\w*)";
  const tsStrong =
    /\b(interface|enum|namespace|declare|implements)\s+[A-Za-z_$]/.test(body) ||
    /\b(readonly|public|private|protected)\s+[A-Za-z_$]/.test(body) ||
    /\bas\s+[A-Z]\w*/.test(body);
  const tsAnnotation =
    new RegExp(`\\b(?:let|const|var)\\s+[\\w$]+\\s*:\\s*${TYPE}`).test(body) ||
    new RegExp(`\\([^)]*\\b[\\w$]+\\s*:\\s*${TYPE}`).test(body) ||
    new RegExp(`\\)\\s*:\\s*${TYPE}[\\w<>\\[\\]|]*\\s*(?:\\{|=>|;|$)`, "m").test(body);
  if (tsStrong || tsAnnotation) return "typescript";

  // Sesgo por módulo: el de TypeScript etiqueta TypeScript por defecto.
  if (/typescript/i.test(moduleTitle)) return "typescript";

  return "javascript";
}
