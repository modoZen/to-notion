import { isAutolinkLine, unescapeAll } from "../unescape.ts";
import type { ClassifiedKind } from "../types.ts";

// ===========================================================================
// 4. CLASIFICACIÓN código vs prosa
// ===========================================================================
//
// El problema central: en el .docx el código pegado no tiene NINGUNA marca.
// Hay una señal fuerte específica de este documento (y de casi cualquier
// pegado desde un editor a Word): el código llega con espacios duros (NBSP,
// U+00A0) en lugar de espacios normales, y la sangría también es NBSP.
// La prosa usa NBSP suelto como mucho una o dos veces por párrafo.
//
// `classifyLine` combina dos capas: primero los casos límite documentados en
// el prototipo como DEFECTO N (autoenlaces, sangría NBSP, freno de prosa,
// negrita-como-sentencia, mixedProse, rótulos de archivo/español, comentario
// de cola), que deciden 'prose' o 'code' de forma terminante; si ninguno
// aplica, cae al motor de puntaje (KEYWORD_START, SHELL_START, API_TOKENS,
// sintaxis dura) que decide entre 'code' y 'unknown'.
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

// Palabras funcionales del español. Se usan como freno: si una línea larga
// las contiene y no cierra con sintaxis de código, es prosa.
const CONNECTORS = new RegExp(
  "\\b(" +
    // conectores
    "que|para|cuando|porque|entonces|donde|como|pero|sino|desde|hasta|aunque|mientras|" +
    "según|sobre|además|también|siempre|nunca|cada|entre|durante|mediante|" +
    // determinantes y preposiciones
    "el|la|los|las|un|una|unos|unas|del|al|de|en|con|por|sin|su|sus|lo|" +
    // verbos y pronombres frecuentes
    "es|son|está|están|ser|estar|hay|tiene|tienen|se|nos|le|les|" +
    "podemos|debemos|tenemos|permite|permiten|sirve|significa|decir|usamos|" +
    // demostrativos
    "esto|esta|este|estos|estas|eso|ese|esa|nuestro|nuestra|nuestros|todo|toda" +
    ")\\b",
  "i",
);

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

// Texto puro: letras, dígitos, espacios, comas, signos de interrogación y
// exclamación, apóstrofes y guiones. Admite `.` o `:` final. Nada de
// paréntesis, llaves, corchetes, `=`, `;`, `<`, `>`, comillas ni puntos
// intermedios: en cuanto aparece uno de esos, deja de ser texto puro.
const PURE_TEXT = /^[\p{L}\p{M}\d\s,'¿?¡!-]+[.:]?$/u;

// Marca de que la línea está en español. Basta una tilde o una palabra
// funcional; no hace falta que sea una oración completa.
const SPANISH_WORD = new RegExp(
  "[áéíóúñÁÉÍÓÚÑ]|\\b(" +
    "el|la|los|las|un|una|unos|unas|de|del|al|en|con|por|sin|para|que|si|no|y|o|u|e|" +
    "otra|otro|otras|otros|más|menos|como|cuando|entre|sobre|desde|hasta|" +
    "es|son|está|están|hay|ser|estar|nuestro|nuestra|nuestros|su|sus|lo|se|" +
    "cambio|ejemplo|caso|casos|forma|manera|solución|explicación|nota|resumen|" +
    "tenemos|vemos|usamos|ejecutamos|podemos|debemos|hacemos|" +
    "solo|sólo|también|además|pero|aunque|entonces|luego|ahora|" +
    "a|esto|esta|este|estos|estas|eso|ese|esa|dos|tres|todo|toda|todos|todas" +
    ")\\b",
  "i",
);

/**
 * Una ruta de archivo suelta: `Assets/plugins/Ads/Ads.json`, `Assets/index.css`,
 * `Assets/MediaPlayer`, `package.json`.
 *
 * En el Word estas líneas separan un listado de archivo del siguiente. No son
 * código: son el rótulo que dice de qué archivo es el bloque que viene. Sin
 * esta regla la vecindad se las traga y cuatro archivos distintos terminan
 * fusionados en un solo fence con un solo lenguaje.
 *
 * No pueden llevar espacios ni sintaxis: eso descarta `import x from './a.json'`
 * y cualquier expresión con una división.
 */
const FILE_PATH_LABEL = new RegExp(
  "^(?:\\.{0,2}/)?[\\w.@-]+(?:/[\\w.@-]+)+/?$" + // Assets/plugins/Ads.json
    "|^(?:\\./)?[\\w-]+\\.(?:json|jsonc|ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|" +
    "html|htm|vue|svelte|md|yml|yaml|txt|xml|svg|lock|env|sh|toml|ini)$", // package.json
  "i",
);

// Un nombre de archivo o una ruta suelta dentro de una frase.
const FILE_TOKEN = new RegExp(
  "\\b[\\w-]+\\.(?:json|jsonc|ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|htm|vue|" +
    "svelte|md|yml|yaml|txt|xml|svg|lock|env|sh|toml|ini|png|jpe?g|gif|mp4)\\b" +
    "|\\b[\\w-]+(?:/[\\w.-]+)+\\b",
  "gi",
);

const SPANISH_FUNCTION_WORD =
  /\b(el|la|los|las|un|una|unos|unas|de|del|al|en|con|sin|por|para|que|si|y|o|u|e|entre|sobre|desde|hasta|como|cuando|pero|aunque|es|son|está|están|hay|se|su|sus|lo|no|más|otra|otro|también|además|nuestro|nuestra)\b/gi;

export function wordCount(s: string): number {
  return s
    .replace(/\u00a0/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Sangría hecha con NBSP al inicio de línea: firma inequívoca de código. */
function hasNbspIndent(line: string): boolean {
  return /^[\u00a0 ]*\u00a0[\u00a0 ]*\S/.test(line) && /^[\u00a0 ]*\u00a0/.test(line);
}

function nbspRatio(line: string): number {
  const nb = (line.match(/\u00a0/g) || []).length;
  if (nb === 0) return 0;
  const sp = (line.match(/ /g) || []).length;
  return nb / (nb + sp);
}

/**
 * Quita el comentario `//` de fin de línea sin tocar `https://` ni las barras
 * que vivan dentro de un string.
 *
 * Hace falta porque el chequeo de "termina en `;`" miraba el final crudo de la
 * línea, y en `x = [10, "hello"]; // Error` el `;` queda tapado por el
 * comentario. La línea perdía su señal más fuerte y se iba a prosa.
 */
function stripLineComment(t: string): string {
  let quote: string | null = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quote) {
      if (c === quote && t[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "/" && t[i + 1] === "/" && t[i - 1] !== ":") return t.slice(0, i);
  }
  return t;
}

/**
 * Si toda la línea viene envuelta en negritas de Word (`**foo()**`), se
 * quitan para poder mirar el contenido real.
 */
export function stripWholeLineEmphasis(line: string): string {
  const m = line.match(/^(\s*)\*\*([\s\S]+?)\*\*(\s*)$/);
  return m ? m[1] + m[2] + m[3] : line;
}

/**
 * Quita de una línea todo lo que es sintaxis y devuelve lo que sobra.
 *
 * El orden importa: primero los strings (para que su contenido en español no
 * se cuente como prosa), después los identificadores con punto, después las
 * llamadas, y al final la puntuación suelta.
 */
function proseResidue(t: string): string {
  return t
    .replace(/`[^`]*`/g, " ")
    .replace(/'[^']*'|"[^"]*"/g, " ")
    .replace(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g, " ")
    .replace(/[A-Za-z_$][\w$]*\s*\([^()]*\)/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/<\/?[A-Za-z][^<>]*>/g, " ")
    .replace(/[*_=;:{}()[\]<>+/%|&!?~^@#\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prosa que CITA código. La tercera categoría que faltaba.
 *
 * `**Diferencia **entre element.onclick = function(){} y element.addEventListener(...)`
 * no es ni prosa limpia ni código: es una oración en español con fragmentos de
 * código dentro. Se reconoce por el residuo — al quitarle la sintaxis quedan
 * palabras funcionales del español formando un esqueleto de oración.
 *
 * En código de verdad el residuo se vacía o deja solo identificadores.
 */
export function mixedProse(text: string): boolean {
  const residue = proseResidue(String(text));
  const words = residue.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  const hits = new Set((residue.match(SPANISH_FUNCTION_WORD) || []).map((w) => w.toLowerCase()));
  return hits.size >= 2;
}

export function isFilePathLabel(text: string): boolean {
  const t = stripWholeLineEmphasis(String(text)).trim();
  if (/\s/.test(t)) return false;
  if (/^(?:https?|ftp|mailto):/i.test(t)) return false;
  return FILE_PATH_LABEL.test(t);
}

export function isSpanishLabel(text: string): boolean {
  const raw = stripWholeLineEmphasis(String(text)).trim();
  // "Creamos el archivo sw.js" es una frase, no código. El nombre del archivo
  // se saca antes de comprobar si lo demás es texto llano; si no, el punto de
  // `sw.js` rompe el patrón y la frase entera se va a código.
  const t = raw.replace(FILE_TOKEN, " ").replace(/\s+/g, " ").trim();
  const wc = wordCount(t);
  if (wc < 2) return false;
  if (!PURE_TEXT.test(t)) return false;
  if (KEYWORD_START.test(t) || SHELL_START.test(t)) return false;

  // Con cuatro palabras o más de texto llano y puntuación de oración, es
  // prosa aunque no reconozca ninguna palabra. Toda lista de vocabulario
  // tiene huecos —`estos`, `dos`, `a` faltaban en la mía— y no quiero que
  // una frase se vaya a código por una palabra que se me olvidó escribir.
  if (wc >= 4 && /[.:]$/.test(t)) return true;

  return SPANISH_WORD.test(t);
}

/**
 * ¿Los paréntesis de esta línea son una LLAMADA o una glosa?
 *
 * `console.log(document.visibilityState)` es una llamada.
 * `AST (Abstract Syntax Tree)` y `Mongoose( caso de uso)` son rótulos del
 * Word con una aclaración entre paréntesis. Se distinguen por lo que va
 * dentro: argumentos de código llevan comillas, puntos, `=` o van vacíos;
 * una glosa son palabras normales.
 */
function looksLikeCall(text: string): boolean {
  const m = String(text).match(/[\w$]\s*\(([^()]*)\)/);
  if (!m) return false;
  const arg = m[1].trim();
  if (arg === "") return true; // f()
  if (/["'`;=]|=>/.test(arg)) return true; // f("x"), f(a = 1)
  if (/[A-Za-z_$][\w$]*\.[A-Za-z_$]/.test(arg)) return true; // f(a.b)
  if (/^-?\d+(?:\.\d+)?$/.test(arg)) return true; // f(3)
  return false; // (Abstract Syntax Tree)
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

/** Puntaje de código para una línea ya desescapada y sin comentario de cola. */
function scoreCodeLine(
  t: string,
  trimmed: string,
  endsCodeish: boolean,
  wc: number,
  hasCommentTail: boolean,
): number {
  let score = 0;
  if (KEYWORD_START.test(t)) score += 3;
  if (SHELL_START.test(t)) score += 3;
  if (API_TOKENS.test(t)) score += 3;
  if (/=>/.test(t)) score += 3;
  if (endsCodeish) score += 2;
  // Una cola `// ...` sobre código real no aparece en prosa: las URLs y las
  // barras dentro de strings ya quedaron descartadas por stripLineComment.
  if (hasCommentTail) score += 3;
  if (/^\s*["'`]?[\w$@/-]+["'`]?\s*:\s*.+[,;]?\s*$/.test(trimmed) && wc <= 12) score += 2;
  if (/^\s*\.\w+\(/.test(t)) score += 2;
  const callAtEnd = /\w+\s*\(([^()]*)\)\s*[;{]?\s*$/.exec(trimmed);
  if (callAtEnd && wc <= 10 && !isGlossArg(callAtEnd[1])) score += 2;
  // `S -- Single Responsibility` no es un decremento: el `--` de código va
  // pegado al identificador (`i--`, `--i`), nunca suelto entre espacios.
  if (/[=!<>]==?|\w\+\+|\+\+\w|\w--|--\w|&&|\|\||\?\?/.test(t)) score += 1;
  if (/[a-zA-Z_$]\w*\.[a-zA-Z_$]\w*/.test(t)) score += 1;
  if (/[()[\]{}]/.test(t)) score += 1;
  if (!ACCENTED.test(t)) score += 1;
  if (wc <= 4) score += 1;
  return score;
}

/**
 * Clasifica UNA línea ya desescapada.
 * Devuelve 'code' | 'prose' | 'unknown'.
 */
export function classifyLine(rawLine: string): ClassifiedKind {
  const t = unescapeAll(rawLine);
  const trimmed = t.trim();
  if (trimmed === "") return "unknown";

  // --- DEFECTO 1: una URL suelta nunca es un bloque de código -------------
  if (isAutolinkLine(rawLine) || /^\s*(?:https?|ftp):\/\/\S+\s*$/.test(trimmed)) return "prose";

  // Entrada de índice: enlace a un ancla interna. Los del Word vienen
  // anidados (`[Título [6](#x)](#x)`), así que se detecta por el `](#`.
  if (/\]\(#/.test(rawLine)) return "prose";
  // Línea compuesta solo por enlaces markdown.
  if (/^(\s*\[[^\]]*\]\([^)]*\)\s*)+$/.test(rawLine)) return "prose";

  // --- Señales de código que ganan siempre (van antes del freno de prosa
  //     porque un comentario en español es prosa de forma pero código de
  //     ubicación) ---------------------------------------------------------
  if (/^\s*(\/\/|\/\*|\*\/)/.test(t)) return "code";
  if (hasNbspIndent(rawLine)) return "code";
  if (nbspRatio(rawLine) >= 0.5) return "code";

  // Etiqueta HTML al inicio — evaluado sobre el texto DESESCAPADO (DEFECTO 5)
  if (/^\s*<\/?[a-zA-Z][\w:-]*(\s[^<>]*)?\/?>/.test(t)) return "code";
  if (/^\s*<!(DOCTYPE|--)/i.test(t)) return "code";

  // Cierre de bloque solo
  if (/^\s*[}\])]+[;,)]?\s*$/.test(trimmed)) return "code";
  if (/^\s*[{[]\s*$/.test(trimmed)) return "code";

  // --- DEFECTO 3: freno de prosa -----------------------------------------
  // 7+ palabras, con conectores del español, y sin terminar en { } ;
  const wc = wordCount(t);
  // El cuerpo de código: la línea sin su comentario de cola.
  const codeBody = stripLineComment(t).trim();
  const hasCommentTail = codeBody.length > 0 && codeBody.length < trimmed.length;
  const endsCodeish = /[{};]\s*$/.test(codeBody);

  // Línea envuelta entera en negritas. En este .docx eso es casi siempre un
  // subtítulo de Word (**Boolean**, **Array**, **Parcel:**), pero a veces es
  // código que el autor resaltó en negrita. Se decide por el contenido, no
  // por el formato.
  const bold = trimmed.match(/^\*\*([\s\S]+?)\*\*[.:]?$/);
  if (bold) {
    const inner = bold[1].trim();
    // Es código solo si parece una SENTENCIA. Un identificador pelado en
    // negrita (`Object.create`, `element.onclick`) es un rótulo de sección
    // del Word, aunque el nombre esté en mi lista de APIs. La diferencia con
    // `document.addEventListener("x", function() {` es que aquella tiene
    // paréntesis con argumentos y abre una llave.
    const isCode =
      HARD_SYNTAX.test(inner) ||
      KEYWORD_START.test(inner) ||
      /=>/.test(inner) ||
      /[;{}]\s*$/.test(inner) ||
      looksLikeCall(inner);
    return isCode ? "code" : "prose";
  }

  if (wc >= 7 && CONNECTORS.test(t) && !endsCodeish && !HARD_SYNTAX.test(t)) return "prose";

  // Etiqueta suelta en español: texto puro, sin NADA de sintaxis de código.
  // Son las líneas cortas del Word tipo "Otra solución", "Explicación extra",
  // "Si en nuestro código tenemos:". El freno de arriba no las agarra porque
  // pide 7 palabras y estas tienen dos o tres, así que quedaban `unknown` y
  // la resolución por vecindad se las tragaba cuando caían entre dos bloques.
  // Esta regla devuelve prosa de forma terminante: no importa qué las rodee.
  if (isSpanishLabel(t)) return "prose";

  // Prosa que cita código: se decide por el residuo, no por el puntaje. Va
  // antes del sistema de puntos porque ahí `addEventListener(` vale +3 y
  // hunde cualquier oración que mencione una API.
  if (mixedProse(t)) return "prose";

  // Rótulo de archivo: prosa, y de paso corta el bloque en dos.
  if (isFilePathLabel(t)) return "prose";
  // Frase larga con acentos y punto final: prosa.
  if (wc >= 6 && ACCENTED.test(t) && /[.:]\s*$/.test(trimmed) && !endsCodeish) return "prose";

  // --- Puntaje de código --------------------------------------------------
  const score = scoreCodeLine(t, trimmed, endsCodeish, wc, hasCommentTail);

  if (score >= 4) return "code";
  if (score >= 3 && wc <= 8) return "code";
  return "unknown";
}
