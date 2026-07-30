import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SyncState } from "./types.ts";

export function statePath(outDir: string): string {
  return join(outDir, ".notion-sync-state.json");
}

export function loadState(outDir: string): SyncState {
  const p = statePath(outDir);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}

export function saveState(outDir: string, state: SyncState): void {
  writeFileSync(statePath(outDir), JSON.stringify(state, null, 2), "utf8");
}
