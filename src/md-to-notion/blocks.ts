import { safeLang } from "./lang.ts";
import { makeText, parseInline, splitRichText } from "./rich-text.ts";
import type { MdToBlocksOptions, MdToBlocksResult, NotionBlock } from "./types.ts";

const B_HEADING = /^(#{1,3})\s+(.*)$/;
const B_FENCE = /^```(.*)$/;

/**
 * markdown -> bloques.
 *
 * opts.imageMode:
 *   'callout'  marcador visible, para la validación por MCP
 *   'marker'   bloque de imagen en blanco con el token en el caption; el
 *              script final lo sustituye tras subir el archivo
 */
export function mdToBlocks(markdown: string, opts: MdToBlocksOptions = {}): MdToBlocksResult {
  const lines = markdown.split("\n");
  const blocks: NotionBlock[] = [];
  const images: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = B_FENCE.exec(line);
    if (fence) {
      const lang = safeLang(fence[1]);
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // cerrar el fence, aunque falte (avanzar siempre)
      blocks.push({
        object: "block",
        type: "code",
        code: { language: lang, rich_text: splitRichText([makeText(body.join("\n"))]) },
      });
      continue;
    }

    const h = B_HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      if (level === 1) {
        blocks.push({
          object: "block",
          type: "heading_1",
          heading_1: { rich_text: parseInline(h[2]), is_toggleable: false },
        });
      } else if (level === 2) {
        blocks.push({
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: parseInline(h[2]), is_toggleable: false },
        });
      } else {
        blocks.push({
          object: "block",
          type: "heading_3",
          heading_3: { rich_text: parseInline(h[2]), is_toggleable: false },
        });
      }
      i++;
      continue;
    }

    // Párrafo: una línea = un bloque (el conversor ya normalizó con --wrap=none)
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: parseInline(line.trim()) },
    });
    i++;
  }

  return { blocks, images };
}
