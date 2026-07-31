import { notion } from "./client.ts";
import type { CourseProperties } from "./types.ts";

interface NotionPageResponse {
  id: string;
}

function toNotionProperties(properties: CourseProperties): Record<string, unknown> {
  return {
    Título: { title: [{ type: "text", text: { content: properties.titulo } }] },
    Área: { select: { name: properties.area } },
    Plataforma: { select: { name: properties.plataforma } },
    Estado: { select: { name: properties.estado } },
    Módulos: { number: properties.modulos },
    "Archivo origen": { rich_text: [{ type: "text", text: { content: properties.archivoOrigen } }] },
    "Última sincronización": { date: { start: properties.ultimaSincronizacion } },
  };
}

export async function createCourse(databaseId: string, properties: CourseProperties): Promise<string> {
  const page = await notion<NotionPageResponse>("POST", "/pages", {
    parent: { database_id: databaseId },
    properties: toNotionProperties(properties),
  });
  return page.id;
}

export async function updateCourseAfterSync(pageId: string, modulos: number): Promise<void> {
  await notion("PATCH", `/pages/${pageId}`, {
    properties: {
      Módulos: { number: modulos },
      "Última sincronización": { date: { start: new Date().toISOString() } },
    },
  });
}
