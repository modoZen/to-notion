import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CourseRegistry } from "./types.ts";

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
