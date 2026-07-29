import { unescapeAll } from "../unescape.ts";

// ===========================================================================
// 4. CLASIFICACIÓN código vs prosa — heurísticos base y sistema de puntaje
// ===========================================================================
//
// El problema central: en el .docx el código pegado no tiene NINGUNA marca.
// Este archivo cubre el motor de puntaje (palabras clave, comandos de shell,
// APIs conocidas, sintaxis dura). Los casos límite documentados como
// DEFECTO N en el prototipo (autoenlaces, sangría NBSP, freno de prosa,
// negrita-como-sentencia, mixedProse, rótulos en español, comentario de
// cola) se agregan sobre este motor en un paso posterior.
//

export const KEYWORD_START = new RegExp(
  "^\\s*(const|let|var|function|class|import|export|return|if|else|for|while|switch|case|" +
    "break|continue|try|catch|finally|throw|new|typeof|instanceof|delete|async|await|" +
    "interface|type|enum|namespace|declare|abstract|implements|extends|super|static|yield|" +
    "do|default|public|private|protected|readonly|constructor|get|set|module|require|from)\\b",
);

export const SHELL_START =
  /^\s*(npm|npx|yarn|pnpm|pnpx|git|node|tsc|deno|bun|cd|rm|ls|mkdir|touch|cp|mv|curl|code|parcel|webpack|vite|http-server|live-server|serve|sudo|chmod|echo|export)\s+\S/;

export const API_TOKENS =
  /\b(console\.(log|error|warn|info|table|dir|trace)|document\.(getElementById|querySelector|querySelectorAll|createElement|addEventListener|body|head)|window\.[a-z]|navigator\.[a-z]|localStorage\.|sessionStorage\.|JSON\.(parse|stringify)|Object\.(keys|values|assign|entries|create|freeze|defineProperty|getPrototypeOf)|Array\.(from|isArray|prototype)|Math\.[a-z]|Promise\.(all|resolve|reject|race)|module\.exports|exports\.|require\(|addEventListener\(|\.prototype\.|this\.[a-zA-Z_$])/;

/**
 * Sintaxis dura de código: si aparece, el freno de prosa no aplica aunque la
 * línea parezca una oración (comentarios largos, strings en español dentro de
 * un JSON, etc.).
 */
export const HARD_SYNTAX = new RegExp(
  "=>|" +
    "\\bfunction\\s*\\(|" +
    "\\)\\s*\\{|" +
    "[;{}]\\s*$|" +
    "^\\s*[\"'`][\\w$.-]+[\"'`]\\s*:|" + // "clave": ...
    "^\\s*[\\w$-]+\\s*:\\s*[\"'`{[]|" + // clave: "valor" / { / [
    "^\\s*<[a-zA-Z/!]|" + // etiqueta HTML
    "^\\s*\\w+\\s*=\\s*\\w", // asignación
);

export const ACCENTED = /[áéíóúñ¿¡ÁÉÍÓÚÑ]/;

export function wordCount(s: string): number {
  return s
    .replace(/\u00a0/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Argumento que en realidad es una aclaración, no un parámetro.
 * `(SRP)`, `(iterable)`, `(Abstract Syntax Tree)` son glosas en prosa;
 * `('video')`, `(1,3)`, `(document.body)`, `()` son argumentos de verdad.
 */
export function isGlossArg(arg: string): boolean {
  const a = String(arg).trim();
  if (a === "") return false;
  if (/["'`;=.]|=>|\d/.test(a)) return false;
  return /^[\p{L}][\p{L}\s-]*$/u.test(a);
}

/**
 * Puntaje de código para una línea ya desescapada. El recorte del comentario
 * de cola (`// ...`) y el resto de los casos límite se suman en el paso que
 * extiende este clasificador; acá `endsCodeish` se evalúa contra la línea
 * completa.
 */
function scoreCodeLine(t: string, trimmed: string, wc: number): number {
  let score = 0;
  if (KEYWORD_START.test(t)) score += 3;
  if (SHELL_START.test(t)) score += 3;
  if (API_TOKENS.test(t)) score += 3;
  if (/=>/.test(t)) score += 3;
  const endsCodeish = /[{};]\s*$/.test(trimmed);
  if (endsCodeish) score += 2;
  if (/^\s*["'`]?[\w$@/-]+["'`]?\s*:\s*.+[,;]?\s*$/.test(trimmed) && wc <= 12) score += 2;
  if (/^\s*\.\w+\(/.test(t)) score += 2;
  const callAtEnd = /\w+\s*\(([^()]*)\)\s*[;{]?\s*$/.exec(trimmed);
  if (callAtEnd && wc <= 10 && !isGlossArg(callAtEnd[1])) score += 2;
  if (/[=!<>]==?|\w\+\+|\+\+\w|\w--|--\w|&&|\|\||\?\?/.test(t)) score += 1;
  if (/[a-zA-Z_$]\w*\.[a-zA-Z_$]\w*/.test(t)) score += 1;
  if (/[()[\]{}]/.test(t)) score += 1;
  if (!ACCENTED.test(t)) score += 1;
  if (wc <= 4) score += 1;
  return score;
}

/**
 * Versión base del clasificador de línea: solo el motor de puntaje, sin los
 * casos límite (autoenlaces, sangría NBSP, freno de prosa, etc.) que se
 * agregan en el paso siguiente. Por eso todavía no devuelve `'prose'`: una
 * línea que no puntúa como código queda `'unknown'` hasta que esos casos se
 * incorporen.
 */
export function classifyLine(rawLine: string): "code" | "unknown" {
  const t = unescapeAll(rawLine);
  const trimmed = t.trim();
  if (trimmed === "") return "unknown";

  const wc = wordCount(t);
  const score = scoreCodeLine(t, trimmed, wc);

  if (score >= 4) return "code";
  if (score >= 3 && wc <= 8) return "code";
  return "unknown";
}
