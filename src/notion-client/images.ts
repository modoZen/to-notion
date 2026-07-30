import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { notion } from "./client.ts";
import type { NotionBlock } from "../md-to-notion/types.ts";

export const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".emf": "image/emf",
};
export const MAX_UPLOAD = 20 * 1024 * 1024;

/**
 * Sube un archivo y devuelve su file_upload id.
 *
 * Tres peticiones: reservar, enviar el contenido, y el id queda listo para
 * adjuntar. OJO: Notion da UNA HORA para adjuntarlo. Por eso las imágenes se
 * suben módulo por módulo, justo antes de crear su página, y no todas de
 * golpe al principio.
 */
export async function uploadImage(filePath: string): Promise<string> {
  const name = basename(filePath);
  const ext = extname(name).toLowerCase();
  const size = statSync(filePath).size;
  if (size > MAX_UPLOAD) {
    throw new Error(`${name}: ${(size / 1048576).toFixed(1)} MB supera el límite de 20 MiB`);
  }

  const created = await notion<{ id: string; upload_url: string }>("POST", "/file_uploads", {
    filename: name,
    content_type: MIME[ext] || "application/octet-stream",
  });

  const form = new FormData();
  form.append("file", new Blob([readFileSync(filePath)], { type: MIME[ext] || "application/octet-stream" }), name);
  // Sin Content-Type explícito: fetch pone el boundary.
  await notion("POST", created.upload_url, form);

  return created.id;
}

/** Sustituye los bloques marcador por bloques de imagen reales. */
export function resolveImages(blocks: NotionBlock[], idByToken: Record<string, string>): NotionBlock[] {
  return blocks.map((b) => {
    if ("_marker" in b && b._marker) {
      const id = idByToken[b._marker];
      if (!id) {
        const { _marker, ...rest } = b; // no se pudo subir: queda el texto
        return rest as NotionBlock;
      }
      return {
        object: "block",
        type: "image",
        image: { type: "file_upload", file_upload: { id }, caption: [] },
      };
    }
    return b;
  });
}
