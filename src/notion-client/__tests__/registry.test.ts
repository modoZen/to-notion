import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRegistry, registryPath, saveRegistry, upsertCourse } from "../registry.ts";
import type { CourseRegistry } from "../types.ts";

describe("registryPath() / loadRegistry() / saveRegistry()", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notion-client-registry-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('registryPath() usa "workspace" como default sin workspaceRoot', () => {
    expect(registryPath()).toBe(join("workspace", "course-registry.json"));
  });

  it("devuelve {} si el archivo de registro no existe", () => {
    expect(loadRegistry(dir)).toEqual({});
  });

  it("un round-trip de saveRegistry + loadRegistry conserva la forma de CourseRegistry", () => {
    const registry: CourseRegistry = {
      "curso-x": {
        pageId: "page-1",
        docxFileName: "curso-x.docx",
        docxHash: "abc123",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-02T00:00:00.000Z",
      },
    };

    saveRegistry(dir, registry);
    expect(loadRegistry(dir)).toEqual(registry);
  });
});

describe("upsertCourse()", () => {
  it("con un slug nuevo crea la entrada con createdAt === lastSyncedAt", () => {
    const registry: CourseRegistry = {};

    upsertCourse(registry, "curso-x", {
      pageId: "page-1",
      docxFileName: "curso-x.docx",
      docxHash: "hash-1",
    });

    expect(registry["curso-x"]).toMatchObject({
      pageId: "page-1",
      docxFileName: "curso-x.docx",
      docxHash: "hash-1",
    });
    expect(registry["curso-x"].createdAt).toBe(registry["curso-x"].lastSyncedAt);
  });

  it("con un slug existente y el mismo docxFileName actualiza pageId/docxHash/lastSyncedAt y conserva createdAt", () => {
    const registry: CourseRegistry = {
      "curso-x": {
        pageId: "page-old",
        docxFileName: "curso-x.docx",
        docxHash: "hash-old",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
    };

    upsertCourse(registry, "curso-x", {
      pageId: "page-new",
      docxFileName: "curso-x.docx",
      docxHash: "hash-new",
    });

    expect(registry["curso-x"].pageId).toBe("page-new");
    expect(registry["curso-x"].docxHash).toBe("hash-new");
    expect(registry["curso-x"].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(registry["curso-x"].lastSyncedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("con un slug existente pero docxFileName distinto lanza Error y no muta registry", () => {
    const original: CourseRegistry = {
      "curso-x": {
        pageId: "page-old",
        docxFileName: "curso-x.docx",
        docxHash: "hash-old",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const registry: CourseRegistry = structuredClone(original);

    expect(() =>
      upsertCourse(registry, "curso-x", {
        pageId: "page-new",
        docxFileName: "curso-x-renombrado.docx",
        docxHash: "hash-new",
      }),
    ).toThrow(/curso-x.*curso-x\.docx.*curso-x-renombrado\.docx/);

    expect(registry).toEqual(original);
  });
});
