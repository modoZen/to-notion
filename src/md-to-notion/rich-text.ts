import type { RichText, RichTextAnnotations } from "./types.ts";

export const MAX_TEXT = 2000; // caracteres por fragmento de rich_text
export const MAX_BLOCKS = 100; // bloques por request

/**
 * Markdown en línea -> array de rich_text con anotaciones.
 *
 * Se recorre la cadena de izquierda a derecha en vez de aplicar regex
 * globales: así el contenido de un `code span` se toma literal y no se
 * reinterpreta como negrita si dentro hay asteriscos.
 */
export function parseInline(input: string): RichText[] {
  const out: RichText[] = [];
  let buf = "";
  let i = 0;

  const flush = (): void => {
    if (buf === "") return;
    out.push(makeText(buf));
    buf = "";
  };

  while (i < input.length) {
    const c = input[i];

    // Escapes de pandoc: \* \_ \` \# \\ -> el carácter, literal.
    if (c === "\\" && i + 1 < input.length) {
      buf += input[i + 1];
      i += 2;
      continue;
    }

    // Código en línea: contenido literal.
    if (c === "`") {
      const end = input.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        out.push(makeText(input.slice(i + 1, end), { code: true }));
        i = end + 1;
        continue;
      }
    }

    // Enlace [texto](url)
    if (c === "[") {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(input.slice(i));
      if (m) {
        flush();
        out.push(makeText(m[1] || m[2], {}, m[2]));
        i += m[0].length;
        continue;
      }
    }

    // URL suelta
    if (c === "h" || c === "f") {
      const m = /^(?:https?|ftp):\/\/[^\s<>()]+/.exec(input.slice(i));
      if (m) {
        flush();
        out.push(makeText(m[0], {}, m[0]));
        i += m[0].length;
        continue;
      }
    }

    // Negrita **texto**
    if (c === "*" && input[i + 1] === "*") {
      const end = input.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        out.push(...parseInline(input.slice(i + 2, end)).map((t) => annotate(t, { bold: true })));
        i = end + 2;
        continue;
      }
    }

    // Cursiva *texto*
    if (c === "*") {
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

export function makeText(content: string, ann: RichTextAnnotations = {}, link: string | null = null): RichText {
  const rt: RichText = { type: "text", text: { content } };
  if (link) rt.text.link = { url: link };
  if (Object.keys(ann).length) rt.annotations = { ...ann };
  return rt;
}

export function annotate(rt: RichText, ann: RichTextAnnotations): RichText {
  return { ...rt, annotations: { ...(rt.annotations || {}), ...ann } };
}

/**
 * Ningún fragmento puede pasar de 2000 caracteres. Se PARTE, nunca se trunca,
 * y se busca un corte en espacio para no romper una palabra por la mitad.
 */
export function splitRichText(items: RichText[]): RichText[] {
  const out: RichText[] = [];
  for (const rt of items) {
    let content = rt.text.content;
    if (content.length <= MAX_TEXT) {
      out.push(rt);
      continue;
    }
    while (content.length > MAX_TEXT) {
      let cut = content.lastIndexOf(" ", MAX_TEXT);
      const nl = content.lastIndexOf("\n", MAX_TEXT);
      if (nl > cut) cut = nl;
      if (cut < MAX_TEXT * 0.5) cut = MAX_TEXT; // sin espacio útil: corte duro
      out.push({ ...rt, text: { ...rt.text, content: content.slice(0, cut) } });
      content = content.slice(cut);
    }
    if (content) out.push({ ...rt, text: { ...rt.text, content } });
  }
  return out;
}
