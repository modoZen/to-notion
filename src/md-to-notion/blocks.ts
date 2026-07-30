import { safeLang } from "./lang.ts";
import { makeText, parseInline, splitRichText } from "./rich-text.ts";
import type { ImageMode, MdToBlocksOptions, MdToBlocksResult, NotionBlock } from "./types.ts";

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
export function mdToBlocks(markdown: string, opts: MdToBlocksOptions = {}): MdToBlocksResult {
  const imageMode = opts.imageMode || "callout";
  const lines = markdown.split("\n");
  const blocks: NotionBlock[] = [];
  const images: string[] = [];
  let i = 0;

  // El primer `# Titulo` es el título de la página, no un bloque.
  if (B_HEADING.test(lines[0] || "") && lines[0].startsWith("# ")) i = 1;

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

    if (B_LIST.test(line)) {
      const [consumed, listBlocks] = takeList(lines, i);
      blocks.push(...listBlocks);
      i = consumed;
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

function imageBlock(token: string, mode: ImageMode): NotionBlock {
  if (mode === "callout") {
    return {
      object: "block",
      type: "callout",
      callout: {
        icon: { type: "emoji", emoji: "🖼️" },
        color: "gray_background",
        rich_text: [makeText(`![](${token})`, { code: true })],
      },
    };
  }
  // 'marker': el script final reemplaza este bloque por uno de imagen real
  // usando el token del caption para saber qué archivo subir.
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [makeText(`![](${token})`, { code: true })] },
    _marker: token,
  };
}

/**
 * Viñetas con anidación. Notion no anida por indentación: el hijo va dentro
 * de `children` del item padre.
 */
function takeList(lines: string[], start: number): [number, NotionBlock[]] {
  const items: { depth: number; text: string }[] = [];
  let i = start;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      // una línea en blanco no corta la lista si lo que sigue sigue siendo lista
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && B_LIST.test(lines[j])) {
        i = j;
        continue;
      }
      break;
    }
    const m = B_LIST.exec(lines[i]);
    if (!m) break;
    items.push({ depth: Math.floor(m[1].length / 4), text: m[2] });
    i++;
  }

  // Reconstruir el árbol por profundidad.
  const roots: NotionBlock[] = [];
  const stack: Extract<NotionBlock, { type: "bulleted_list_item" }>[] = [];
  for (const it of items) {
    const block: Extract<NotionBlock, { type: "bulleted_list_item" }> = {
      object: "block",
      type: "bulleted_list_item",
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
