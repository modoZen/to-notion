import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRegistry, registryPath, saveRegistry } from "../registry.ts";
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
