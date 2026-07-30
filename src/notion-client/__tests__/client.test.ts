import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("notion()", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    delete process.env.NOTION_TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lanza un error claro si NOTION_TOKEN no está seteado", async () => {
    const { notion } = await import("../client.ts");
    await expect(notion("GET", "/x")).rejects.toThrow(/NOTION_TOKEN/);
  });

  it("respeta Retry-After en un 429 antes de reintentar", async () => {
    process.env.NOTION_TOKEN = "t";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "3" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { notion } = await import("../client.ts");
    const promise = notion("GET", "/x");

    await vi.advanceTimersByTimeAsync(0); // rate-limit gap inicial, dispara el primer fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2900); // todavía no pasaron los 3s del retry-after
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200); // cruza los 3s desde el primer fetch
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it("reintenta un 5xx con backoff exponencial hasta MAX_RETRIES y luego lanza error", async () => {
    process.env.NOTION_TOKEN = "t";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" }));
    vi.stubGlobal("fetch", fetchMock);

    const { notion, MAX_RETRIES } = await import("../client.ts");
    const promise = notion("PATCH", "/blocks/1/children");
    promise.catch(() => {}); // evita unhandledRejection mientras avanzamos los timers

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // primer intento, sin backoff todavía

    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES + 1);

    await expect(promise).rejects.toThrow(/PATCH \/blocks\/1\/children -> 500/);
  });

  it("respeta el rate-limit MIN_INTERVAL_MS entre peticiones consecutivas", async () => {
    process.env.NOTION_TOKEN = "t";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { notion, MIN_INTERVAL_MS } = await import("../client.ts");
    await notion("GET", "/x");

    const second = notion("GET", "/x");
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS - 50);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await second;
  });
});

describe("loadEnv()", () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "notion-client-env-"));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
    delete process.env.NOTION_TOKEN;
    delete process.env.OTHER_VAR;
  });

  it("no pisa una variable ya presente en process.env", async () => {
    writeFileSync(join(dir, ".env"), "NOTION_TOKEN=from-file\n");
    process.env.NOTION_TOKEN = "already-set";

    const { loadEnv } = await import("../client.ts");
    loadEnv();

    expect(process.env.NOTION_TOKEN).toBe("already-set");
  });

  it("setea una variable ausente desde .env", async () => {
    writeFileSync(join(dir, ".env"), "OTHER_VAR=hello\n");

    const { loadEnv } = await import("../client.ts");
    loadEnv();

    expect(process.env.OTHER_VAR).toBe("hello");
  });
});
