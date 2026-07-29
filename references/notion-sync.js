#!/usr/bin/env node
'use strict';

/**
 * notion-sync.js
 * ===========================================================================
 * .docx de apuntes  ->  subpáginas de un curso en Notion.
 *
 *   node notion-sync.js <archivo.docx> <PARENT_PAGE_ID> [MODULO_N] [--dry-run]
 *
 * PARENT_PAGE_ID es la fila del curso que YA creaste a mano en el database
 * `Cursos`, abierta como página completa. El script no crea ni modifica filas
 * del database: solo cuelga las subpáginas de los módulos. Así el mismo
 * archivo sirve para cualquier curso sin saber nada de tu esquema.
 *
 * Requisitos:
 *   - Node 18 o superior (fetch, FormData y Blob nativos)
 *   - pandoc en el PATH
 *   - NOTION_TOKEN en un .env del directorio actual
 *   - la fila del curso compartida con esa integración
 *
 * Dos etapas, deliberadamente separadas:
 *   1. .docx -> markdown + imágenes en disco, revisable por un humano
 *   2. markdown -> Notion
 * El markdown se cachea en <archivo>.notion/, así que pandoc corre una sola
 * vez aunque subas los módulos de uno en uno. Si algo sale mal, el markdown
 * en disco te dice de qué lado estuvo el problema.
 *
 * La subida es reanudable: un archivo de estado registra qué módulos ya se
 * crearon bajo qué padre, y un corte a mitad no duplica nada.
 * ===========================================================================
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ===========================================================================
// PARTE 1 — .docx  ->  MARKDOWN
// (copiado literal de docx-to-md.js, validado sobre los 11 módulos)
// ===========================================================================

// ===========================================================================
// 1. PANDOC: .docx -> markdown crudo
// ===========================================================================

function runPandoc(docxPath, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const rawPath = path.join(workDir, 'raw.md');
  const res = spawnSync(
    'pandoc',
    [
      docxPath,
      '-t', 'markdown',
      '--wrap=none',              // DEFECTO 6: sin esto corta a ~72 cols y parte código
      `--extract-media=${workDir}`,
      '-o', rawPath,
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 }
  );
  if (res.status !== 0) {
    throw new Error(`pandoc falló (${res.status}): ${res.stderr}`);
  }
  return rawPath;
}

// ===========================================================================
// 2. DESESCAPADO
// ===========================================================================

const NBSP = '\u00a0';

/**
 * Deshace TODO el escapado de pandoc. Se usa para (a) clasificar y (b) emitir
 * el contenido de los bloques de código.
 *
 * DEFECTO 5: la clasificación tiene que correr sobre el texto ya desescapado.
 * Pandoc entrega `\<script\>` y `\<` nunca hace match contra `<`.
 * DEFECTO 2: el autoenlace `<https://...>` de pandoc también se limpia acá.
 */
function unescapeAll(s) {
  let out = s;
  out = stripAutolinks(out);
  out = out.replace(/\\\.\.\./g, '\u2026');
  out = out.replace(/\\(.)/g, '$1');
  return out;
}

/**
 * Versión conservadora para prosa: mantiene el escapado de pandoc (que es
 * markdown válido y preserva **negritas** e *itálicas*), pero limpia los
 * autoenlaces, que sí se ven mal en el resultado y peor en Notion.
 */
function unescapeProse(s) {
  return stripAutolinks(s)
    .replace(/\\\.\.\./g, '\u2026')
    // Se desescapa todo lo que NO tiene significado en markdown. Quedan
    // escapados `*`, `_`, backtick, `#` y `\`, que sí lo tienen: si se
    // desescapan, la prosa del Word se convierte en formato accidental.
    .replace(/\\([<>"'[\](){}|$~^@+!.,:;=?/&%-])/g, '$1')
    // Word cierra la negrita DESPUÉS del espacio (`**Diferencia **entre`) y
    // markdown no renderiza eso. Se mueve el espacio fuera del marcador.
    .replace(/\*\*(\S(?:[^*]*?\S)?)(\s+)\*\*/g, '**$1**$2')
    .replace(/\*\*(\s+)([^*]*?\S)\*\*/g, '$1**$2**')
    // NBSP: artefacto de Word, no aporta nada en Notion.
    .replace(/\u00a0/g, ' ');
}

/** `<https://x>` -> `https://x`  ·  `<mailto:a@b>` -> `a@b` */
function stripAutolinks(s) {
  return s
    .replace(/\\?<((?:https?|ftp):\/\/[^\s<>]+)\\?>/g, '$1')
    .replace(/\\?<mailto:([^\s<>]+)\\?>/g, '$1');
}

/** ¿La línea es (o empieza como) un autoenlace? DEFECTO 1: no es código. */
function isAutolinkLine(raw) {
  return /^\s*\\?<(?:https?|ftp|mailto):/.test(raw);
}

// ===========================================================================
// 3. TOKENIZADO: markdown crudo -> unidades
// ===========================================================================
//
// Con --wrap=none cada párrafo del .docx es UNA línea. Las unidades son
// grupos de líneas no vacías consecutivas.
//
// tipos: heading | image | list | quote | para | drop
//

const RE_HEADING = /^(#{1,6})\s+(.*?)(?:\s*\{[^}]*\})?\s*$/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+/;
const RE_QUOTE = /^\s*>\s?/;

// Una referencia de imagen de pandoc, en cualquier posición de la línea:
//   ![alt](./media/image57.png){width="3.4in" height="2.0in"}
// Puede venir varias veces en la misma línea (imágenes lado a lado en Word)
// y puede venir pegada a texto. Por eso NO se ancla al inicio ni al final.
const RE_IMAGE_ANY = /!\[[^\]]*\]\(([^)\s]*media\/[^)\s]+)\)(?:\{[^}]*\})?/g;

function tokenize(rawMd) {
  const lines = rawMd.split(/\r?\n/);
  const units = [];
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
      units.push({ type: 'fence', lines: fence });
      i = j + 1;
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    // Agrupar líneas no vacías consecutivas en una unidad.
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^```/.test(lines[i])) {
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
function classifyStructure(buf) {
  const first = buf[0];

  const h = first.match(RE_HEADING);
  if (h && buf.length === 1) {
    return [{ type: 'heading', level: h[1].length, text: unescapeProse(h[2]).trim() }];
  }

  const kind = RE_LIST.test(first) ? 'list' : RE_QUOTE.test(first) ? 'quote' : 'para';
  const out = [];
  let pending = [];

  const flush = () => {
    if (pending.some((l) => l.trim() !== '')) out.push({ type: kind, lines: pending.slice() });
    pending = [];
  };

  for (const line of buf) {
    RE_IMAGE_ANY.lastIndex = 0;
    if (!RE_IMAGE_ANY.test(line)) { pending.push(line); continue; }

    RE_IMAGE_ANY.lastIndex = 0;
    let last = 0;
    let m;
    while ((m = RE_IMAGE_ANY.exec(line)) !== null) {
      const before = line.slice(last, m.index);
      if (before.trim() !== '') { pending.push(before); flush(); } else { flush(); }
      out.push({ type: 'image', src: m[1] });
      last = m.index + m[0].length;
    }
    const after = line.slice(last);
    if (after.trim() !== '') pending.push(after);
  }
  flush();
  return out;
}

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

const KEYWORD_START = new RegExp(
  '^\\s*(const|let|var|function|class|import|export|return|if|else|for|while|switch|case|' +
  'break|continue|try|catch|finally|throw|new|typeof|instanceof|delete|async|await|' +
  'interface|type|enum|namespace|declare|abstract|implements|extends|super|static|yield|' +
  'do|default|public|private|protected|readonly|constructor|get|set|module|require|from)\\b'
);

const SHELL_START = /^\s*(npm|npx|yarn|pnpm|pnpx|git|node|tsc|deno|bun|cd|rm|ls|mkdir|touch|cp|mv|curl|code|parcel|webpack|vite|http-server|live-server|serve|sudo|chmod|echo|export)\s+\S/;

const API_TOKENS = /\b(console\.(log|error|warn|info|table|dir|trace)|document\.(getElementById|querySelector|querySelectorAll|createElement|addEventListener|body|head)|window\.[a-z]|navigator\.[a-z]|localStorage\.|sessionStorage\.|JSON\.(parse|stringify)|Object\.(keys|values|assign|entries|create|freeze|defineProperty|getPrototypeOf)|Array\.(from|isArray|prototype)|Math\.[a-z]|Promise\.(all|resolve|reject|race)|module\.exports|exports\.|require\(|addEventListener\(|\.prototype\.|this\.[a-zA-Z_$])/;

// Palabras funcionales del español. Se usan como freno: si una línea larga
// las contiene y no cierra con sintaxis de código, es prosa.
const CONNECTORS = new RegExp(
  '\\b(' +
  // conectores
  'que|para|cuando|porque|entonces|donde|como|pero|sino|desde|hasta|aunque|mientras|' +
  'según|sobre|además|también|siempre|nunca|cada|entre|durante|mediante|' +
  // determinantes y preposiciones
  'el|la|los|las|un|una|unos|unas|del|al|de|en|con|por|sin|su|sus|lo|' +
  // verbos y pronombres frecuentes
  'es|son|está|están|ser|estar|hay|tiene|tienen|se|nos|le|les|' +
  'podemos|debemos|tenemos|permite|permiten|sirve|significa|decir|usamos|' +
  // demostrativos
  'esto|esta|este|estos|estas|eso|ese|esa|nuestro|nuestra|nuestros|todo|toda' +
  ')\\b',
  'i'
);

/**
 * Sintaxis dura de código: si aparece, el freno de prosa no aplica aunque la
 * línea parezca una oración (comentarios largos, strings en español dentro de
 * un JSON, etc.).
 */
const HARD_SYNTAX = new RegExp(
  '=>|' +
  '\\bfunction\\s*\\(|' +
  '\\)\\s*\\{|' +
  '[;{}]\\s*$|' +
  '^\\s*["\'`][\\w$.-]+["\'`]\\s*:|' +      // "clave": ...
  '^\\s*[\\w$-]+\\s*:\\s*["\'`{[]|' +       // clave: "valor" / { / [
  '^\\s*<[a-zA-Z/!]|' +                     // etiqueta HTML
  '^\\s*\\w+\\s*=\\s*\\w'                   // asignación
);

const ACCENTED = /[áéíóúñ¿¡ÁÉÍÓÚÑ]/;

// Texto puro: letras, dígitos, espacios, comas, signos de interrogación y
// exclamación, apóstrofes y guiones. Admite `.` o `:` final. Nada de
// paréntesis, llaves, corchetes, `=`, `;`, `<`, `>`, comillas ni puntos
// intermedios: en cuanto aparece uno de esos, deja de ser texto puro.
const PURE_TEXT = /^[\p{L}\p{M}\d\s,'¿?¡!-]+[.:]?$/u;

// Marca de que la línea está en español. Basta una tilde o una palabra
// funcional; no hace falta que sea una oración completa.
const SPANISH_WORD = new RegExp(
  '[áéíóúñÁÉÍÓÚÑ]|\\b(' +
  'el|la|los|las|un|una|unos|unas|de|del|al|en|con|por|sin|para|que|si|no|y|o|u|e|' +
  'otra|otro|otras|otros|más|menos|como|cuando|entre|sobre|desde|hasta|' +
  'es|son|está|están|hay|ser|estar|nuestro|nuestra|nuestros|su|sus|lo|se|' +
  'cambio|ejemplo|caso|casos|forma|manera|solución|explicación|nota|resumen|' +
  'tenemos|vemos|usamos|ejecutamos|podemos|debemos|hacemos|' +
  'solo|sólo|también|además|pero|aunque|entonces|luego|ahora|' +
  'a|esto|esta|este|estos|estas|eso|ese|esa|dos|tres|todo|toda|todos|todas' +
  ')\\b',
  'i'
);

function nbspRatio(line) {
  const nb = (line.match(/\u00a0/g) || []).length;
  if (nb === 0) return 0;
  const sp = (line.match(/ /g) || []).length;
  return nb / (nb + sp);
}

/** Sangría hecha con NBSP al inicio de línea: firma inequívoca de código. */
function hasNbspIndent(line) {
  return /^[\u00a0 ]*\u00a0[\u00a0 ]*\S/.test(line) && /^[\u00a0 ]*\u00a0/.test(line);
}

/**
 * Quita el comentario `//` de fin de línea sin tocar `https://` ni las barras
 * que vivan dentro de un string.
 *
 * Hace falta porque el chequeo de "termina en `;`" miraba el final crudo de la
 * línea, y en `x = [10, "hello"]; // Error` el `;` queda tapado por el
 * comentario. La línea perdía su señal más fuerte y se iba a prosa.
 */
function stripLineComment(t) {
  let quote = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quote) {
      if (c === quote && t[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && t[i + 1] === '/' && t[i - 1] !== ':') return t.slice(0, i);
  }
  return t;
}

function wordCount(s) {
  return s.replace(/\u00a0/g, ' ').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * ¿Es una etiqueta suelta en español? ("Otra solución", "Explicación extra",
 * "Si en nuestro código tenemos:").
 *
 * Esto lo consultan DOS sitios y por eso vive aparte: el clasificador, para
 * devolver prosa, y el pase de fusión, para NO absorberla. Sin lo segundo el
 * clasificador acierta y la fusión lo deshace acto seguido.
 */
/**
 * Quita de una línea todo lo que es sintaxis y devuelve lo que sobra.
 *
 * El orden importa: primero los strings (para que su contenido en español no
 * se cuente como prosa), después los identificadores con punto, después las
 * llamadas, y al final la puntuación suelta.
 */
function proseResidue(t) {
  return t
    .replace(/`[^`]*`/g, ' ')
    .replace(/'[^']*'|"[^"]*"/g, ' ')
    .replace(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g, ' ')
    .replace(/[A-Za-z_$][\w$]*\s*\([^()]*\)/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/<\/?[A-Za-z][^<>]*>/g, ' ')
    .replace(/[*_=;:{}()\[\]<>+/%|&!?~^@#\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SPANISH_FUNCTION_WORD = /\b(el|la|los|las|un|una|unos|unas|de|del|al|en|con|sin|por|para|que|si|y|o|u|e|entre|sobre|desde|hasta|como|cuando|pero|aunque|es|son|está|están|hay|se|su|sus|lo|no|más|otra|otro|también|además|nuestro|nuestra)\b/gi;

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
function mixedProse(text) {
  const residue = proseResidue(String(text));
  const words = residue.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  const hits = new Set((residue.match(SPANISH_FUNCTION_WORD) || []).map((w) => w.toLowerCase()));
  return hits.size >= 2;
}

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
  '^(?:\\.{0,2}/)?[\\w.@-]+(?:/[\\w.@-]+)+/?$' +          // Assets/plugins/Ads.json
  '|^(?:\\./)?[\\w-]+\\.(?:json|jsonc|ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|' +
  'html|htm|vue|svelte|md|yml|yaml|txt|xml|svg|lock|env|sh|toml|ini)$',   // package.json
  'i'
);

function isFilePathLabel(text) {
  const t = stripWholeLineEmphasis(String(text)).trim();
  if (/\s/.test(t)) return false;
  if (/^(?:https?|ftp|mailto):/i.test(t)) return false;
  return FILE_PATH_LABEL.test(t);
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
function looksLikeCall(text) {
  const m = String(text).match(/[\w$]\s*\(([^()]*)\)/);
  if (!m) return false;
  const arg = m[1].trim();
  if (arg === '') return true;                                  // f()
  if (/["\'`;=]|=>/.test(arg)) return true;                      // f("x"), f(a = 1)
  if (/[A-Za-z_$][\w$]*\.[A-Za-z_$]/.test(arg)) return true;     // f(a.b)
  if (/^-?\d+(?:\.\d+)?$/.test(arg)) return true;               // f(3)
  return false;                                                  // (Abstract Syntax Tree)
}

// Un nombre de archivo o una ruta suelta dentro de una frase.
const FILE_TOKEN = new RegExp(
  '\\b[\\w-]+\\.(?:json|jsonc|ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|htm|vue|' +
  'svelte|md|yml|yaml|txt|xml|svg|lock|env|sh|toml|ini|png|jpe?g|gif|mp4)\\b' +
  '|\\b[\\w-]+(?:/[\\w.-]+)+\\b',
  'gi'
);

function isSpanishLabel(text) {
  const raw = stripWholeLineEmphasis(String(text)).trim();
  // "Creamos el archivo sw.js" es una frase, no código. El nombre del archivo
  // se saca antes de comprobar si lo demás es texto llano; si no, el punto de
  // `sw.js` rompe el patrón y la frase entera se va a código.
  const t = raw.replace(FILE_TOKEN, ' ').replace(/\s+/g, ' ').trim();
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
 * Clasifica UNA línea ya desescapada.
 * Devuelve 'code' | 'prose' | 'unknown'.
 */
function classifyLine(rawLine) {
  const t = unescapeAll(rawLine);
  const trimmed = t.trim();
  if (trimmed === '') return 'unknown';

  // --- DEFECTO 1: una URL suelta nunca es un bloque de código -------------
  if (isAutolinkLine(rawLine) || /^\s*(?:https?|ftp):\/\/\S+\s*$/.test(trimmed)) return 'prose';

  // Entrada de índice: enlace a un ancla interna. Los del Word vienen
  // anidados (`[Título [6](#x)](#x)`), así que se detecta por el `](#`.
  if (/\]\(#/.test(rawLine)) return 'prose';
  // Línea compuesta solo por enlaces markdown.
  if (/^(\s*\[[^\]]*\]\([^)]*\)\s*)+$/.test(rawLine)) return 'prose';

  // --- Señales de código que ganan siempre (van antes del freno de prosa
  //     porque un comentario en español es prosa de forma pero código de
  //     ubicación) ---------------------------------------------------------
  if (/^\s*(\/\/|\/\*|\*\/)/.test(t)) return 'code';
  if (hasNbspIndent(rawLine)) return 'code';
  if (nbspRatio(rawLine) >= 0.5) return 'code';

  // Etiqueta HTML al inicio — evaluado sobre el texto DESESCAPADO (DEFECTO 5)
  if (/^\s*<\/?[a-zA-Z][\w:-]*(\s[^<>]*)?\/?>/.test(t)) return 'code';
  if (/^\s*<!(DOCTYPE|--)/i.test(t)) return 'code';

  // Cierre de bloque solo
  if (/^\s*[}\])]+[;,)]?\s*$/.test(trimmed)) return 'code';
  if (/^\s*[{[]\s*$/.test(trimmed)) return 'code';

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
    return isCode ? 'code' : 'prose';
  }

  if (wc >= 7 && CONNECTORS.test(t) && !endsCodeish && !HARD_SYNTAX.test(t)) return 'prose';

  // Etiqueta suelta en español: texto puro, sin NADA de sintaxis de código.
  // Son las líneas cortas del Word tipo "Otra solución", "Explicación extra",
  // "Si en nuestro código tenemos:". El freno de arriba no las agarra porque
  // pide 7 palabras y estas tienen dos o tres, así que quedaban `unknown` y
  // la resolución por vecindad se las tragaba cuando caían entre dos bloques.
  // Esta regla devuelve prosa de forma terminante: no importa qué las rodee.
  if (isSpanishLabel(t)) return 'prose';

  // Prosa que cita código: se decide por el residuo, no por el puntaje. Va
  // antes del sistema de puntos porque ahí `addEventListener(` vale +3 y
  // hunde cualquier oración que mencione una API.
  if (mixedProse(t)) return 'prose';

  // Rótulo de archivo: prosa, y de paso corta el bloque en dos.
  if (isFilePathLabel(t)) return 'prose';
  // Frase larga con acentos y punto final: prosa.
  if (wc >= 6 && ACCENTED.test(t) && /[.:]\s*$/.test(trimmed) && !endsCodeish) return 'prose';

  // --- Puntaje de código --------------------------------------------------
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

  if (score >= 4) return 'code';
  if (score >= 3 && wc <= 8) return 'code';
  return 'unknown';
}

/** Una unidad `para` puede tener varias líneas; decide por mayoría con sesgo. */
function classifyUnit(unit) {
  // Word mete algunos listados dentro de una cita. Pandoc los entrega como
  // blockquote y hasta ahora nunca podían ser código, así que el CSS salía
  // como texto citado en vez de bloque. Se decide por el contenido, sin el
  // prefijo `>`.
  if (unit.type === 'quote') {
    const votes = unit.lines.map((l) => classifyLine(l.replace(/^\s*>\s?/, '')));
    const c = votes.filter((v) => v === 'code').length;
    const p = votes.filter((v) => v === 'prose').length;
    return c > 0 && c >= p ? 'code' : 'quote';
  }
  if (unit.type !== 'para') return unit.type;
  const votes = unit.lines.map(classifyLine);
  if (votes.includes('code') && !votes.includes('prose')) return 'code';
  if (votes.includes('prose') && !votes.includes('code')) return 'prose';
  const c = votes.filter((v) => v === 'code').length;
  const p = votes.filter((v) => v === 'prose').length;
  if (c > p) return 'code';
  if (p > c) return 'prose';
  return 'unknown';
}

// ===========================================================================
// 5. RESOLUCIÓN DE CONTEXTO Y FUSIÓN
// ===========================================================================

/**
 * Los `unknown` se deciden por vecindad: si están rodeados de código, son
 * código. Si no, prosa. Esto es lo que salva las líneas neutras (`}`,
 * `count: 3`, cadenas sueltas) que caen en medio de un bloque.
 */
function resolveUnknowns(kinds) {
  const out = kinds.slice();

  // Un `unknown` solo se vuelve código si sus vecinos INMEDIATOS resueltos son
  // código, saltando únicamente otros `unknown`. Cualquier otra cosa
  // (encabezado, lista, cita, imagen) corta la vecindad: si en medio hay una
  // viñeta, los dos bloques de código no son el mismo bloque.
  const neighbor = (i, step) => {
    for (let j = i + step; j >= 0 && j < out.length; j += step) {
      if (out[j] === 'unknown') continue;
      return out[j];
    }
    return null;
  };

  for (let i = 0; i < out.length; i++) {
    if (kinds[i] !== 'unknown') continue;
    const prev = neighbor(i, -1);
    const next = neighbor(i, +1);
    out[i] = prev === 'code' && next === 'code' ? 'code' : 'prose';
  }
  return out;
}

/**
 * DEFECTO 4: un bloque partido en tres por una sola línea corta tipo `count: 3`
 * que se clasificó como prosa. Si entre dos bloques de código hay exactamente
 * una unidad `prose` corta, sin puntuación de oración, se absorbe.
 */
function fuseSplitBlocks(units, kinds) {
  const out = kinds.slice();
  for (let i = 1; i < units.length - 1; i++) {
    if (out[i] !== 'prose' || units[i].type !== 'para') continue;
    if (out[i - 1] !== 'code' || out[i + 1] !== 'code') continue;
    const text = unescapeAll(units[i].lines.join(' ')).trim();
    // Una etiqueta en español no se absorbe NUNCA, por corta que sea y aunque
    // tenga código a los dos lados. Es texto del Word, no una línea de código
    // suelta como el `count: 3` que esta fusión existe para reunir.
    if (isSpanishLabel(text) || mixedProse(text) || isFilePathLabel(text)) continue;
    const wc = wordCount(text);
    const sentenceLike = /[.!?]\s*$/.test(text) && wc >= 5;
    if (wc <= 6 && !sentenceLike) out[i] = 'code';
  }
  return out;
}

// ===========================================================================
// 6. LENGUAJE DEL BLOQUE (DEFECTO 8)
// ===========================================================================

function detectLanguage(codeText, moduleTitle) {
  const lines = codeText.split('\n').map((l) => l.trim()).filter(Boolean);
  const body = lines.join('\n');
  const n = lines.length || 1;

  const htmlish = lines.filter((l) => /^<\/?[a-zA-Z!]/.test(l)).length;
  if (/^<!DOCTYPE\s+html/i.test(body) || htmlish / n >= 0.6) return 'html';

  if (/^\s*(npm|npx|yarn|pnpm|git|tsc|node|cd|rm|mkdir|sudo|curl)\b/.test(lines[0] || '') &&
      lines.every((l) => /^(npm|npx|yarn|pnpm|git|tsc|node|cd|rm|ls|mkdir|touch|cp|mv|curl|code|sudo|#|\$)/.test(l))) {
    return 'bash';
  }

  const looksJson = /^[{[]/.test(body) && /"[^"]+"\s*:/.test(body) &&
    !/\b(function|const|let|var|=>|return)\b/.test(body);
  if (looksJson) return 'json';

  const cssish = lines.filter((l) => /^[.#]?[\w-]+\s*\{$|^[\w-]+\s*:\s*[^;]+;$/.test(l)).length;
  if (cssish / n >= 0.7 && !/\b(function|const|let|var|=>)\b/.test(body)) return 'css';

  // TypeScript: hay que pedir una anotación de tipo real. Un ternario
  // (`a.paused ? this.play() : this.pause()`) también produce `):` y hacía
  // que JavaScript plano se etiquetara como TypeScript.
  const TYPE = '(?:string|number|boolean|any|void|never|unknown|object|symbol|bigint|Array<|Promise<|[A-Z]\\w*)';
  const tsStrong =
    /\b(interface|enum|namespace|declare|implements)\s+[A-Za-z_$]/.test(body) ||
    /\b(readonly|public|private|protected)\s+[A-Za-z_$]/.test(body) ||
    /\bas\s+[A-Z]\w*/.test(body);
  const tsAnnotation =
    new RegExp(`\\b(?:let|const|var)\\s+[\\w$]+\\s*:\\s*${TYPE}`).test(body) ||
    new RegExp(`\\([^)]*\\b[\\w$]+\\s*:\\s*${TYPE}`).test(body) ||
    new RegExp(`\\)\\s*:\\s*${TYPE}[\\w<>\\[\\]|]*\\s*(?:\\{|=>|;|$)`, 'm').test(body);
  if (tsStrong || tsAnnotation) return 'typescript';

  // Sesgo por módulo: el de TypeScript etiqueta TypeScript por defecto.
  if (/typescript/i.test(moduleTitle)) return 'typescript';

  return 'javascript';
}



// ===========================================================================
// 7. EMISIÓN
// ===========================================================================

/**
 * Si toda la línea viene envuelta en negritas de Word (`**foo()**`), se
 * quitan al meterla en un bloque de código: dentro de un fence los asteriscos
 * no son formato, son basura visible.
 */
function stripWholeLineEmphasis(line) {
  const m = line.match(/^(\s*)\*\*([\s\S]+?)\*\*(\s*)$/);
  return m ? m[1] + m[2] + m[3] : line;
}

/** Líneas de una unidad listas para meter en un fence. */
function unitCodeLines(unit) {
  let lines = unit.lines;
  if (unit.type === 'quote') {
    lines = lines.map((l) => l.replace(/^\s*>\s?/, ''));
    // Word mete un párrafo por línea dentro de la cita y pandoc los separa
    // con un `>` vacío, así que el listado sale con un blanco entre cada
    // línea. Si más de la mitad son blancos es espaciado del Word, no líneas
    // en blanco que el autor puso a propósito.
    const blanks = lines.filter((l) => l.trim() === '').length;
    if (blanks > 0 && blanks * 3 >= lines.length) lines = lines.filter((l) => l.trim() !== '');
  }
  return lines.map((l) =>
    stripWholeLineEmphasis(unescapeAll(l)).replace(/\u00a0/g, ' ').replace(/\s+$/, '')
  );
}

/**
 * Un `</html>` cierra el documento. Lo que venga después es otro archivo y
 * casi siempre otro lenguaje: en este curso, el HTML de la página seguido
 * del TypeScript que la acompaña, pegados sin separador. Antes salían en un
 * solo fence y el detector etiquetaba los dos con el lenguaje que dominara
 * en número de líneas.
 */
/**
 * Word parte algunas asignaciones largas en dos párrafos: `const url =` en uno
 * y la URL en el siguiente. Pandoc los entrega como líneas distintas y el
 * bloque sale cortado a la mitad. Se vuelven a unir.
 *
 * Solo aplica al `=` de asignación: se excluye `==`, `!=`, `<=`, `+=` y demás,
 * para no pegar una comparación con la línea de abajo.
 */
function joinDanglingAssignments(lines) {
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /[^=!<>+\-*/%&|^]=\s*$/.test(prev) && l.trim() !== '') {
      out[out.length - 1] = prev.replace(/\s*$/, ' ') + l.trim();
    } else {
      out.push(l);
    }
  }
  return out;
}

function splitAtDocumentEnd(code) {
  const lines = code.split('\n');
  const idx = lines.findIndex((l) => /^\s*<\/html>\s*$/i.test(l));
  if (idx === -1 || idx === lines.length - 1) return [code];
  return [lines.slice(0, idx + 1).join('\n'), ...splitAtDocumentEnd(lines.slice(idx + 1).join('\n'))];
}

/**
 * Argumento que en realidad es una aclaración, no un parámetro.
 * `(SRP)`, `(iterable)`, `(Abstract Syntax Tree)` son glosas en prosa;
 * `('video')`, `(1,3)`, `(document.body)`, `()` son argumentos de verdad.
 */
function isGlossArg(arg) {
  const a = String(arg).trim();
  if (a === '') return false;
  if (/["\'`;=.]|=>|\d/.test(a)) return false;
  return /^[\p{L}][\p{L}\s-]*$/u.test(a);
}

function imageMarker(src) {
  // ./media/image110.png  ->  ![](image110.png)   <- token estable, no tocar
  return `![](${path.basename(src)})`;
}

function renderModule(units, kinds, moduleTitle) {
  const out = [];
  const stats = { code: 0, images: 0, headings: 0, lists: 0, paras: 0, quotes: 0 };
  let i = 0;

  while (i < units.length) {
    const u = units[i];
    const k = kinds[i];

    if (k === 'code') {
      const start = i;
      const segments = [];
      let buf = [];
      let depth = 0;

      while (i < units.length && kinds[i] === 'code') {
        const lines = unitCodeLines(units[i]);
        const firstTrim = (lines[0] || '').trim();

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
            if (ch === '{' || ch === '[') depth++;
            else if (ch === '}' || ch === ']') depth--;
          }
        }
        if (depth < 0) depth = 0;
        i++;
      }
      if (buf.length) segments.push(buf);
      // DEFECTO 9: si por lo que sea no se consumió nada, avanzar igual.
      if (i === start) i++;

      for (const seg of segments) {
        const whole = joinDanglingAssignments(seg).join('\n').replace(/^\n+|\n+$/g, '');
        for (const code of splitAtDocumentEnd(whole)) {
          if (code.trim() === '') continue;
          const lang = safeLang(detectLanguage(code, moduleTitle));
          out.push('```' + lang, code, '```', '');
          stats.code++;
        }
      }
      continue;
    }

    switch (u.type) {
      case 'heading':
        out.push('#'.repeat(Math.min(u.level, 6)) + ' ' + u.text, '');
        stats.headings++;
        break;
      case 'image':
        out.push(imageMarker(u.src), '');
        stats.images++;
        break;
      case 'list':
        out.push(...u.lines.map((l) => unescapeProse(l).replace(/\s+$/, '')), '');
        stats.lists++;
        break;
      case 'quote':
        out.push(...u.lines.map((l) => unescapeProse(l).replace(/\s+$/, '')), '');
        stats.quotes++;
        break;
      case 'fence':
        out.push(...u.lines, '');
        break;
      default:
        out.push(...u.lines.map((l) => unescapeProse(l).replace(/\s+$/, '')), '');
        stats.paras++;
    }
    i++;
  }

  // Colapsar líneas en blanco repetidas.
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  return { text, stats };
}

// ===========================================================================
// 8. ORQUESTACIÓN
// ===========================================================================

function slugify(s) {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'modulo';
}

function splitModules(units) {
  const mods = [];
  let cur = null;
  for (const u of units) {
    if (u.type === 'heading' && u.level === 1) {
      cur = { title: u.text, units: [] };
      mods.push(cur);
      continue;
    }
    if (!cur) continue; // preámbulo antes del primer H1: se descarta
    cur.units.push(u);
  }
  return mods;
}

function convertDocx(args) {
  const outDir = path.resolve(args.out);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx2md-'));

  const rawPath = runPandoc(path.resolve(args.docx), workDir);
  const rawMd = fs.readFileSync(rawPath, 'utf8');

  const units = tokenize(rawMd);
  const modules = splitModules(units);

  // Quitar el índice. Se identifica por el título o porque casi todo su
  // contenido son enlaces a anclas internas, no por su posición.
  if (!args.keepIndex && modules.length) {
    const first = modules[0];
    const anchors = first.units.filter(
      (u) => u.lines && u.lines.some((l) => /\]\(#/.test(l))
    ).length;
    const isIndex = /^(contenido|índice|indice|tabla de contenido)/i.test(first.title) ||
      anchors >= Math.max(3, first.units.length * 0.6);
    if (isIndex) modules.shift();
  }

  const modulesDir = path.join(outDir, 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });

  // Copiar los medios extraídos junto a la salida.
  const srcMedia = path.join(workDir, 'media');
  const dstMedia = path.join(outDir, 'media');
  if (fs.existsSync(srcMedia)) {
    fs.mkdirSync(dstMedia, { recursive: true });
    for (const f of fs.readdirSync(srcMedia)) {
      fs.copyFileSync(path.join(srcMedia, f), path.join(dstMedia, f));
    }
  }

  const manifest = { source: path.basename(args.docx), generated: new Date().toISOString(), modules: [] };
  const report = [];

  modules.forEach((mod, idx) => {
    const number = idx + 1;
    if (args.only && !args.only.includes(number)) return;

    let kinds = mod.units.map(classifyUnit);
    kinds = resolveUnknowns(kinds);
    kinds = fuseSplitBlocks(mod.units, kinds);

    const { text, stats } = renderModule(mod.units, kinds, mod.title);
    const file = `${String(number).padStart(2, '0')}-${slugify(mod.title)}.md`;
    const header = `# ${mod.title}\n\n`;
    fs.writeFileSync(path.join(modulesDir, file), header + text, 'utf8');

    const imgs = (text.match(/!\[\]\((image[^)]+)\)/g) || []).map((m) => m.slice(4, -1));
    manifest.modules.push({ number, title: mod.title, file: `modules/${file}`, images: imgs, stats });
    report.push(
      `${String(number).padStart(2, ' ')}  ${file.padEnd(42)} ` +
      `código=${String(stats.code).padStart(3)}  imgs=${String(stats.images).padStart(3)}  ` +
      `H2=${String(stats.headings).padStart(2)}  párr=${String(stats.paras).padStart(3)}  listas=${String(stats.lists).padStart(3)}`
    );
  });

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.txt'), report.join('\n') + '\n', 'utf8');
  console.log(report.join('\n'));
  console.log(`\nsalida: ${outDir}`);
}


// ===========================================================================
// PARTE 2 — MARKDOWN  ->  BLOQUES DE NOTION
// (copiado literal de md-to-blocks.js, verificado contra la página real)
// ===========================================================================

const MAX_TEXT = 2000;    // caracteres por fragmento de rich_text
const MAX_BLOCKS = 100;   // bloques por request

// Lista cerrada de Notion. Todo lo que no esté acá se manda como 'plain text'.
const NOTION_LANGS = new Set([
  'abap', 'arduino', 'bash', 'basic', 'c', 'clojure', 'coffeescript', 'c++', 'c#',
  'css', 'dart', 'diff', 'docker', 'elixir', 'elm', 'erlang', 'flow', 'fortran',
  'f#', 'gherkin', 'glsl', 'go', 'graphql', 'groovy', 'haskell', 'html', 'java',
  'javascript', 'json', 'julia', 'kotlin', 'latex', 'less', 'lisp', 'livescript',
  'lua', 'makefile', 'markdown', 'markup', 'matlab', 'mermaid', 'nix',
  'objective-c', 'ocaml', 'pascal', 'perl', 'php', 'plain text', 'powershell',
  'prolog', 'protobuf', 'python', 'r', 'reason', 'ruby', 'rust', 'sass', 'scala',
  'scheme', 'scss', 'shell', 'sql', 'swift', 'typescript', 'vb.net', 'verilog',
  'vhdl', 'visual basic', 'webassembly', 'xml', 'yaml',
]);

// ===========================================================================
// RICH TEXT
// ===========================================================================

/**
 * Markdown en línea -> array de rich_text con anotaciones.
 *
 * Se recorre la cadena de izquierda a derecha en vez de aplicar regex
 * globales: así el contenido de un `code span` se toma literal y no se
 * reinterpreta como negrita si dentro hay asteriscos.
 */
function parseInline(input) {
  const out = [];
  let buf = '';
  let i = 0;

  const flush = (ann, link) => {
    if (buf === '') return;
    out.push(makeText(buf, ann, link));
    buf = '';
  };

  while (i < input.length) {
    const c = input[i];

    // Escapes de pandoc: \* \_ \` \# \\ -> el carácter, literal.
    if (c === '\\' && i + 1 < input.length) { buf += input[i + 1]; i += 2; continue; }

    // Código en línea: contenido literal.
    if (c === '`') {
      const end = input.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        out.push(makeText(input.slice(i + 1, end), { code: true }));
        i = end + 1;
        continue;
      }
    }

    // Enlace [texto](url)
    if (c === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(input.slice(i));
      if (m) {
        flush();
        out.push(makeText(m[1] || m[2], {}, m[2]));
        i += m[0].length;
        continue;
      }
    }

    // URL suelta
    if (c === 'h' || c === 'f') {
      const m = /^(?:https?|ftp):\/\/[^\s<>()]+/.exec(input.slice(i));
      if (m) {
        flush();
        out.push(makeText(m[0], {}, m[0]));
        i += m[0].length;
        continue;
      }
    }

    // Negrita **texto**
    if (c === '*' && input[i + 1] === '*') {
      const end = input.indexOf('**', i + 2);
      if (end !== -1) {
        flush();
        out.push(...parseInline(input.slice(i + 2, end)).map((t) => annotate(t, { bold: true })));
        i = end + 2;
        continue;
      }
    }

    // Cursiva *texto*
    if (c === '*') {
      const m = /^\*([^*\n]+)\*/.exec(input.slice(i));
      if (m) {
        flush();
        out.push(...parseInline(m[1]).map((t) => annotate(t, { italic: true })));
        i += m[0].length;
        continue;
      }
    }

    buf += c;
    i++;
  }
  flush();
  return out.length ? splitRichText(out) : [];
}

function makeText(content, ann = {}, link = null) {
  const rt = { type: 'text', text: { content } };
  if (link) rt.text.link = { url: link };
  if (Object.keys(ann).length) rt.annotations = { ...ann };
  return rt;
}

function annotate(rt, ann) {
  return { ...rt, annotations: { ...(rt.annotations || {}), ...ann } };
}

/**
 * Ningún fragmento puede pasar de 2000 caracteres. Se PARTE, nunca se trunca,
 * y se busca un corte en espacio para no romper una palabra por la mitad.
 */
function splitRichText(items) {
  const out = [];
  for (const rt of items) {
    let content = rt.text.content;
    if (content.length <= MAX_TEXT) { out.push(rt); continue; }
    while (content.length > MAX_TEXT) {
      let cut = content.lastIndexOf(' ', MAX_TEXT);
      const nl = content.lastIndexOf('\n', MAX_TEXT);
      if (nl > cut) cut = nl;
      if (cut < MAX_TEXT * 0.5) cut = MAX_TEXT;   // sin espacio útil: corte duro
      out.push({ ...rt, text: { ...rt.text, content: content.slice(0, cut) } });
      content = content.slice(cut);
    }
    if (content) out.push({ ...rt, text: { ...rt.text, content } });
  }
  return out;
}

// ===========================================================================
// BLOQUES
// ===========================================================================

function safeLang(lang) {
  const l = String(lang || '').trim().toLowerCase();
  return NOTION_LANGS.has(l) ? l : 'plain text';
}

const B_HEADING = /^(#{1,3})\s+(.*)$/;
const B_LIST = /^(\s*)[-*+]\s+(.*)$/;
const B_IMAGE = /^!\[\]\((image[^)]+)\)\s*$/;
const B_FENCE = /^```(.*)$/;

/**
 * markdown -> bloques.
 *
 * opts.imageMode:
 *   'callout'  marcador visible, para la validación por MCP
 *   'marker'   bloque de imagen en blanco con el token en el caption; el
 *              script final lo sustituye tras subir el archivo
 */
function mdToBlocks(markdown, opts = {}) {
  const imageMode = opts.imageMode || 'callout';
  const lines = markdown.split('\n');
  const blocks = [];
  const images = [];
  let i = 0;

  // El primer `# Titulo` es el título de la página, no un bloque.
  if (B_HEADING.test(lines[0] || '') && lines[0].startsWith('# ')) i = 1;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    const fence = B_FENCE.exec(line);
    if (fence) {
      const lang = safeLang(fence[1]);
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // cerrar el fence, aunque falte (avanzar siempre)
      blocks.push({
        object: 'block',
        type: 'code',
        code: { language: lang, rich_text: splitRichText([makeText(body.join('\n'))]) },
      });
      continue;
    }

    const img = B_IMAGE.exec(line);
    if (img) {
      images.push(img[1]);
      blocks.push(imageBlock(img[1], imageMode));
      i++;
      continue;
    }

    const h = B_HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      blocks.push({
        object: 'block',
        type: `heading_${level}`,
        [`heading_${level}`]: { rich_text: parseInline(h[2]), is_toggleable: false },
      });
      i++;
      continue;
    }

    if (B_LIST.test(line)) {
      const [consumed, listBlocks] = takeList(lines, i);
      blocks.push(...listBlocks);
      i = consumed;
      continue;
    }

    // Párrafo: una línea = un bloque (el conversor ya normalizó con --wrap=none)
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: parseInline(line.trim()) },
    });
    i++;
  }

  return { blocks, images };
}

function imageBlock(token, mode) {
  if (mode === 'callout') {
    return {
      object: 'block',
      type: 'callout',
      callout: {
        icon: { type: 'emoji', emoji: '🖼️' },
        color: 'gray_background',
        rich_text: [makeText(`![](${token})`, { code: true })],
      },
    };
  }
  // 'marker': el script final reemplaza este bloque por uno de imagen real
  // usando el token del caption para saber qué archivo subir.
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [makeText(`![](${token})`, { code: true })] },
    _marker: token,
  };
}

/**
 * Viñetas con anidación. Notion no anida por indentación: el hijo va dentro
 * de `children` del item padre.
 */
function takeList(lines, start) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      // una línea en blanco no corta la lista si lo que sigue sigue siendo lista
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && B_LIST.test(lines[j])) { i = j; continue; }
      break;
    }
    const m = B_LIST.exec(lines[i]);
    if (!m) break;
    items.push({ depth: Math.floor(m[1].length / 4), text: m[2] });
    i++;
  }

  // Reconstruir el árbol por profundidad.
  const roots = [];
  const stack = [];
  for (const it of items) {
    const block = {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: parseInline(it.text) },
    };
    while (stack.length > it.depth) stack.pop();
    if (stack.length === 0) {
      roots.push(block);
    } else {
      const parent = stack[stack.length - 1];
      const bag = parent.bulleted_list_item;
      (bag.children || (bag.children = [])).push(block);
    }
    stack.push(block);
  }
  return [i, roots];
}

/** Lotes de 100: el primero va en el create, el resto por PATCH children. */
function batch(blocks, size = MAX_BLOCKS) {
  const out = [];
  for (let i = 0; i < blocks.length; i += size) out.push(blocks.slice(i, i + size));
  return out;
}

// ===========================================================================
// PARTE 3 — CLIENTE DE NOTION
// ===========================================================================
//
// Todo lo que toca la red vive acá. Las partes 1 y 2 son puras y ya fueron
// verificadas sin credenciales; esta es la que solo se puede probar contra
// Notion de verdad.
//

const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const MIN_INTERVAL_MS = 340;          // ~3 req/s
const MAX_RETRIES = 5;

let lastRequest = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lee un .env sencillo del directorio actual. Sin dependencias. */
function loadEnv() {
  for (const file of ['.env', path.join(process.cwd(), '.env')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i.exec(line);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, '');
      if (!(m[1] in process.env)) process.env[m[1]] = value;
    }
    break;
  }
}

/**
 * Petición a la API con límite de ritmo y reintentos.
 * Respeta `Retry-After` en los 429 y reintenta los 5xx con espera creciente.
 */
async function notion(method, endpoint, body, extra = {}) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('Falta NOTION_TOKEN (ponlo en .env o en el entorno)');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequest);
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();

    const headers = {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      ...(extra.headers || {}),
    };
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const url = endpoint.startsWith('http') ? endpoint : API + endpoint;
    const res = await fetch(url, { method, headers, body: payload });

    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after') || 1);
      console.log(`    429, esperando ${after}s`);
      await sleep(after * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${endpoint} -> ${res.status}: ${text.slice(0, 400)}`);
    }
    return res.json();
  }
  throw new Error(`${method} ${endpoint}: agotados los reintentos`);
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.emf': 'image/emf',
};
const MAX_UPLOAD = 20 * 1024 * 1024;

/**
 * Sube un archivo y devuelve su file_upload id.
 *
 * Tres peticiones: reservar, enviar el contenido, y el id queda listo para
 * adjuntar. OJO: Notion da UNA HORA para adjuntarlo. Por eso las imágenes se
 * suben módulo por módulo, justo antes de crear su página, y no todas de
 * golpe al principio.
 */
async function uploadImage(filePath) {
  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  const size = fs.statSync(filePath).size;
  if (size > MAX_UPLOAD) throw new Error(`${name}: ${(size / 1048576).toFixed(1)} MB supera el límite de 20 MiB`);

  const created = await notion('POST', '/file_uploads', {
    filename: name,
    content_type: MIME[ext] || 'application/octet-stream',
  });

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: MIME[ext] || 'application/octet-stream' }), name);
  // Sin Content-Type explícito: fetch pone el boundary.
  await notion('POST', created.upload_url, form);

  return created.id;
}

/** Sustituye los bloques marcador por bloques de imagen reales. */
function resolveImages(blocks, idByToken) {
  return blocks.map((b) => {
    if (b._marker) {
      const id = idByToken[b._marker];
      if (!id) {
        const { _marker, ...rest } = b;      // no se pudo subir: queda el texto
        return rest;
      }
      return {
        object: 'block',
        type: 'image',
        image: { type: 'file_upload', file_upload: { id }, caption: [] },
      };
    }
    return b;
  });
}

// ---------------------------------------------------------------------------
// Estado reanudable
// ---------------------------------------------------------------------------

function statePath(outDir) { return path.join(outDir, '.notion-sync-state.json'); }

function loadState(outDir) {
  const p = statePath(outDir);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

function saveState(outDir, state) {
  fs.writeFileSync(statePath(outDir), JSON.stringify(state, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Subida de un módulo
// ---------------------------------------------------------------------------

async function pushModule(mod, mdPath, mediaDir, parentId, outDir, state, dryRun) {
  const key = String(mod.number);
  const bucket = (state[parentId] ||= { modules: {} });
  const prev = bucket.modules[key];

  if (prev && prev.done) {
    console.log(`  ${key}. ${mod.title} — ya estaba subido, se salta`);
    return;
  }

  const md = fs.readFileSync(mdPath, 'utf8');
  const { blocks, images } = mdToBlocks(md, { imageMode: 'marker' });
  const title = `${key}. ${mod.title}`;

  console.log(`  ${title} — ${blocks.length} bloques, ${images.length} imágenes`);
  if (dryRun) return;

  // Una página a medias de un intento anterior se archiva y se rehace: es la
  // única forma barata de no dejar duplicados ni bloques repetidos.
  if (prev && prev.pageId) {
    console.log('    intento anterior incompleto, archivando esa página');
    await notion('PATCH', `/pages/${prev.pageId}`, { archived: true });
  }

  const idByToken = {};
  for (const token of images) {
    const file = path.join(mediaDir, token);
    if (!fs.existsSync(file)) { console.log(`    falta ${token}, se deja el marcador`); continue; }
    idByToken[token] = await uploadImage(file);
  }
  if (images.length) console.log(`    ${Object.keys(idByToken).length}/${images.length} imágenes subidas`);

  const finalBlocks = resolveImages(blocks, idByToken);
  const lotes = batch(finalBlocks);

  const page = await notion('POST', '/pages', {
    parent: { page_id: parentId },
    properties: { title: [{ type: 'text', text: { content: title } }] },
    children: lotes[0] || [],
  });
  bucket.modules[key] = { pageId: page.id, done: false };
  saveState(outDir, state);

  for (let i = 1; i < lotes.length; i++) {
    await notion('PATCH', `/blocks/${page.id}/children`, { children: lotes[i] });
    console.log(`    lote ${i + 1}/${lotes.length}`);
  }

  bucket.modules[key].done = true;
  saveState(outDir, state);
  console.log(`    listo: ${page.url || page.id}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USO = `
uso:  node notion-sync.js <archivo.docx> <PARENT_PAGE_ID> [MODULO_N] [--dry-run]

  archivo.docx     el documento de origen
  PARENT_PAGE_ID   id de la fila del curso que ya creaste en Notion
  MODULO_N         opcional: sube solo ese módulo. Sin él, sube todos.
  --dry-run        convierte y calcula, pero no toca la red

  El token va en NOTION_TOKEN, en un .env del directorio actual.
  El markdown y las imágenes quedan en <archivo>.notion/ y se reutilizan
  entre corridas: pandoc solo se ejecuta la primera vez.
`;

async function main() {
  loadEnv();
  const argv = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dryRun = process.argv.includes('--dry-run');

  const [docx, parentId, moduleArg] = argv;
  if (!docx || !parentId) { console.log(USO); process.exit(1); }
  if (!fs.existsSync(docx)) { console.error(`No existe ${docx}`); process.exit(1); }

  const outDir = docx.replace(/\.docx$/i, '') + '.notion';
  const modulesDir = path.join(outDir, 'modules');
  const mediaDir = path.join(outDir, 'media');

  // --- Etapa 1: convertir, solo si no está hecho ---------------------------
  if (fs.existsSync(path.join(outDir, 'manifest.json'))) {
    console.log(`Markdown ya presente en ${outDir}, se reutiliza`);
  } else {
    console.log(`Convirtiendo ${docx} …`);
    convertDocx({ docx: path.resolve(docx), out: outDir, only: null, keepIndex: false });
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  let mods = manifest.modules;
  if (moduleArg) {
    const n = parseInt(moduleArg, 10);
    mods = mods.filter((m) => m.number === n);
    if (!mods.length) { console.error(`No hay módulo ${n}. Van del 1 al ${manifest.modules.length}.`); process.exit(1); }
  }

  // --- Comprobación de acceso antes de crear nada -------------------------
  if (!dryRun) {
    try {
      const parent = await notion('GET', `/pages/${parentId.replace(/-/g, '')}`);
      const t = parent.properties && Object.values(parent.properties).find((p) => p.type === 'title');
      const nombre = t && t.title && t.title[0] ? t.title[0].plain_text : '(sin título)';
      console.log(`Padre: ${nombre}`);
    } catch (e) {
      console.error('\nNo pude leer la página padre. Revisa que:');
      console.error('  - NOTION_TOKEN sea el de la integración (no el de tu sesión)');
      console.error('  - la fila del curso esté compartida con esa integración');
      console.error('  - el id sea el de la fila abierta como página, sin el ?v=…\n');
      console.error(String(e.message));
      process.exit(1);
    }
  }

  const state = loadState(outDir);
  console.log(`\nSubiendo ${mods.length} módulo(s)${dryRun ? ' (simulación)' : ''}:`);
  for (const mod of mods) {
    await pushModule(mod, path.join(outDir, mod.file), mediaDir, parentId, outDir, state, dryRun);
  }
  console.log('\nListo.');
}

if (require.main === module) {
  main().catch((e) => { console.error('\n' + e.message); process.exit(1); });
}


// Exportado para las pruebas; no afecta el uso como script.
module.exports = { convertDocx, mdToBlocks, parseInline, splitRichText, batch,
                   safeLang, resolveImages, NOTION_LANGS, MAX_TEXT, MAX_BLOCKS };
