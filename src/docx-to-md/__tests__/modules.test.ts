import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import type { Unit } from "../types.ts";
import {
  courseFolderName,
  courseSlug,
  isIndexModule,
  removeIndexModule,
  slugify,
  splitModules,
} from "../modules.ts";
import type { SplitModule } from "../modules.ts";

describe("slugify", () => {
  it("quita acentos y pasa a minúsculas", () => {
    expect(slugify("Módulo Introducción")).toBe("modulo-introduccion");
  });

  it("convierte símbolos y espacios en guiones simples", () => {
    expect(slugify("Hola, Mundo!! ¿Qué tal?")).toBe("hola-mundo-que-tal");
  });

  it("recorta guiones al inicio y al final", () => {
    expect(slugify("--Título--")).toBe("titulo");
  });

  it("trunca a 50 caracteres", () => {
    const largo = "a".repeat(80);
    expect(slugify(largo)).toBe("a".repeat(50));
  });

  it("devuelve 'modulo' cuando no queda nada alfanumérico", () => {
    expect(slugify("¡¡¡???!!!")).toBe("modulo");
    expect(slugify("")).toBe("modulo");
  });
});

describe("courseFolderName", () => {
  it("devuelve el basename de la carpeta contenedora", () => {
    expect(courseFolderName("/cursos/CursoA/Clases.docx")).toBe("CursoA");
  });

  it("una ruta relativa sin carpeta explícita resuelve contra el cwd", () => {
    expect(() => courseFolderName("Clases.docx")).not.toThrow();
    expect(courseFolderName("Clases.docx")).toBe(basename(process.cwd()));
  });
});

describe("courseSlug", () => {
  it("mismo basename en carpetas distintas produce slugs distintos", () => {
    const a = courseSlug("/cursos/CursoA/Clases.docx");
    const b = courseSlug("/cursos/CursoB/Clases.docx");
    expect(a).not.toBe(b);
  });

  it("es determinístico: mismo docxPath produce siempre el mismo slug", () => {
    const path = "/cursos/CursoA/Clases.docx";
    expect(courseSlug(path)).toBe(courseSlug(path));
  });

  it("respeta el límite de 50 caracteres de slugify", () => {
    const folder = "a".repeat(40);
    const file = "b".repeat(40);
    const slug = courseSlug(`/cursos/${folder}/${file}.docx`);
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("ruta relativa sin carpeta explícita no rompe (resuelve al cwd)", () => {
    expect(() => courseSlug("Clases.docx")).not.toThrow();
  });
});

describe("splitModules", () => {
  it("descarta el preámbulo antes del primer H1", () => {
    const units: Unit[] = [
      { type: "para", lines: ["preámbulo"] },
      { type: "heading", level: 1, text: "Módulo 1" },
      { type: "para", lines: ["contenido"] },
    ];
    const mods = splitModules(units);
    expect(mods).toEqual([{ title: "Módulo 1", units: [{ type: "para", lines: ["contenido"] }] }]);
  });

  it("agrupa unidades bajo cada H1 y mantiene los H2 dentro del módulo", () => {
    const units: Unit[] = [
      { type: "heading", level: 1, text: "Módulo 1" },
      { type: "heading", level: 2, text: "Sección" },
      { type: "para", lines: ["contenido 1"] },
      { type: "heading", level: 1, text: "Módulo 2" },
      { type: "para", lines: ["contenido 2"] },
    ];
    const mods = splitModules(units);
    expect(mods).toEqual([
      {
        title: "Módulo 1",
        units: [
          { type: "heading", level: 2, text: "Sección" },
          { type: "para", lines: ["contenido 1"] },
        ],
      },
      { title: "Módulo 2", units: [{ type: "para", lines: ["contenido 2"] }] },
    ]);
  });

  it("sin ningún H1 no genera módulos", () => {
    const units: Unit[] = [{ type: "para", lines: ["solo prosa"] }];
    expect(splitModules(units)).toEqual([]);
  });
});

describe("isIndexModule", () => {
  it("reconoce el índice por el título", () => {
    expect(isIndexModule({ title: "Contenido", units: [] })).toBe(true);
    expect(isIndexModule({ title: "Índice", units: [] })).toBe(true);
    expect(isIndexModule({ title: "Indice", units: [] })).toBe(true);
    expect(isIndexModule({ title: "Tabla de contenido", units: [] })).toBe(true);
  });

  it("reconoce el índice cuando la mayoría de las unidades son anclas internas", () => {
    const mod: SplitModule = {
      title: "Lo que vamos a ver",
      units: [
        { type: "para", lines: ["[Módulo 1](#modulo-1)"] },
        { type: "para", lines: ["[Módulo 2](#modulo-2)"] },
        { type: "para", lines: ["[Módulo 3](#modulo-3)"] },
      ],
    };
    expect(isIndexModule(mod)).toBe(true);
  });

  it("un módulo normal, sin título de índice ni anclas, no se marca como índice", () => {
    const mod: SplitModule = {
      title: "Introducción a JavaScript",
      units: [{ type: "para", lines: ["Esto es contenido real del módulo."] }],
    };
    expect(isIndexModule(mod)).toBe(false);
  });
});

describe("removeIndexModule", () => {
  it("quita el primer módulo si es un índice", () => {
    const modules: SplitModule[] = [
      { title: "Contenido", units: [] },
      { title: "Módulo 1", units: [] },
    ];
    expect(removeIndexModule(modules)).toEqual([{ title: "Módulo 1", units: [] }]);
  });

  it("no toca nada si el primer módulo no es un índice", () => {
    const modules: SplitModule[] = [
      { title: "Módulo 1", units: [] },
      { title: "Módulo 2", units: [] },
    ];
    expect(removeIndexModule(modules)).toEqual(modules);
  });

  it("no falla con un arreglo vacío", () => {
    expect(removeIndexModule([])).toEqual([]);
  });
});
