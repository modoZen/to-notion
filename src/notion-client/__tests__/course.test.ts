import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseProperties } from "../types.ts";

const { notionMock } = vi.hoisted(() => ({ notionMock: vi.fn() }));

vi.mock("../client.ts", () => ({ notion: notionMock }));

const { createCourse, updateCourseAfterSync } = await import("../course.ts");

describe("createCourse()", () => {
  beforeEach(() => {
    notionMock.mockReset();
  });

  const properties: CourseProperties = {
    titulo: "Curso Profesional De Javascript",
    area: "Frontend",
    plataforma: "Platzi",
    estado: "Terminado",
    modulos: 12,
    archivoOrigen: "curso-profesional-de-javascript.docx",
    ultimaSincronizacion: "2026-07-30T00:00:00.000Z",
  };

  it("hace POST /pages con parent: { database_id } y las 7 properties mapeadas, sin tocar Notas", async () => {
    notionMock.mockResolvedValueOnce({ id: "page-nuevo" });

    await createCourse("db-cursos", properties);

    expect(notionMock).toHaveBeenCalledWith("POST", "/pages", {
      parent: { database_id: "db-cursos" },
      properties: {
        Título: { title: [{ type: "text", text: { content: "Curso Profesional De Javascript" } }] },
        Área: { select: { name: "Frontend" } },
        Plataforma: { select: { name: "Platzi" } },
        Estado: { select: { name: "Terminado" } },
        Módulos: { number: 12 },
        "Archivo origen": { rich_text: [{ type: "text", text: { content: "curso-profesional-de-javascript.docx" } }] },
        "Última sincronización": { date: { start: "2026-07-30T00:00:00.000Z" } },
      },
    });
    const body = notionMock.mock.calls[0][2] as { properties: Record<string, unknown> };
    expect(body.properties).not.toHaveProperty("Notas");
  });

  it("devuelve el pageId de la fila creada", async () => {
    notionMock.mockResolvedValueOnce({ id: "page-nuevo" });

    await expect(createCourse("db-cursos", properties)).resolves.toBe("page-nuevo");
  });
});

describe("updateCourseAfterSync()", () => {
  beforeEach(() => {
    notionMock.mockReset();
  });

  it("hace PATCH tocando solo Módulos y Última sincronización", async () => {
    notionMock.mockResolvedValueOnce({});

    await updateCourseAfterSync("page-existente", 15);

    expect(notionMock).toHaveBeenCalledTimes(1);
    const [method, endpoint, body] = notionMock.mock.calls[0] as [string, string, { properties: Record<string, unknown> }];
    expect(method).toBe("PATCH");
    expect(endpoint).toBe("/pages/page-existente");
    expect(Object.keys(body.properties)).toEqual(["Módulos", "Última sincronización"]);
    expect(body.properties["Módulos"]).toEqual({ number: 15 });
    expect(body.properties["Última sincronización"]).toMatchObject({ date: { start: expect.any(String) } });
  });
});
