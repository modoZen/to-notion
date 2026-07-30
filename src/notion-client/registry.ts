import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CourseRegistry, NewCourseEntry } from "./types.ts";

export function registryPath(workspaceRoot = "workspace"): string {
  return join(workspaceRoot, "course-registry.json");
}

export function loadRegistry(workspaceRoot = "workspace"): CourseRegistry {
  const p = registryPath(workspaceRoot);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}

export function saveRegistry(
  workspaceRoot: string,
  registry: CourseRegistry,
): void {
  writeFileSync(registryPath(workspaceRoot), JSON.stringify(registry, null, 2), "utf8");
}

/**
 * Muta `registry` en el lugar. Si `slug` ya existe con un `docxFileName`
 * distinto al de `entry` (colisión de slug por truncamiento a 50 caracteres),
 * lanza un Error y no muta `registry`.
 */
export function upsertCourse(
  registry: CourseRegistry,
  slug: string,
  entry: NewCourseEntry,
): void {
  const existing = registry[slug];

  if (existing && existing.docxFileName !== entry.docxFileName) {
    throw new Error(
      `Colisión de slug "${slug}": ya registrado para "${existing.docxFileName}", no para "${entry.docxFileName}"`,
    );
  }

  const now = new Date().toISOString();

  registry[slug] = {
    pageId: entry.pageId,
    docxFileName: entry.docxFileName,
    docxHash: entry.docxHash,
    createdAt: existing?.createdAt ?? now,
    lastSyncedAt: now,
  };
}
