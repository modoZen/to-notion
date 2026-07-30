import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState, saveState } from "../state.ts";
import type { SyncState } from "../types.ts";

describe("loadState() / saveState()", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notion-client-state-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("devuelve {} si el archivo de estado no existe", () => {
    expect(loadState(dir)).toEqual({});
  });

  it("un round-trip de saveState + loadState conserva la forma de SyncState", () => {
    const state: SyncState = {
      "parent-123": {
        modules: {
          "1": { pageId: "page-1", done: true },
          "2": { pageId: "page-2", done: false },
        },
      },
    };

    saveState(dir, state);
    expect(loadState(dir)).toEqual(state);
  });
});
