import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HttpMethod, NotionRequestExtra } from "./types.ts";

const API = "https://api.notion.com/v1";
export const NOTION_VERSION = "2026-03-11";
export const MIN_INTERVAL_MS = 340; // ~3 req/s
export const MAX_RETRIES = 5;

let lastRequest = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Lee un .env sencillo del directorio actual. Sin dependencias. */
export function loadEnv(): void {
  for (const file of [".env", join(process.cwd(), ".env")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i.exec(line);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (!(m[1] in process.env)) process.env[m[1]] = value;
    }
    break;
  }
}

/**
 * Petición a la API con límite de ritmo y reintentos.
 * Respeta `Retry-After` en los 429 y reintenta los 5xx con espera creciente.
 */
export async function notion<T = unknown>(
  method: HttpMethod,
  endpoint: string,
  body?: unknown,
  extra: NotionRequestExtra = {},
): Promise<T> {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("Falta NOTION_TOKEN (ponlo en .env o en el entorno)");

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequest);
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      ...(extra.headers || {}),
    };
    let payload: string | FormData | undefined = undefined;
    if (body !== undefined && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    } else if (body instanceof FormData) {
      payload = body;
    }

    const url = endpoint.startsWith("http") ? endpoint : API + endpoint;
    const res = await fetch(url, { method, headers, body: payload });

    if (res.status === 429) {
      const after = Number(res.headers.get("retry-after") || 1);
      console.log(`    429, esperando ${after}s`);
      await sleep(after * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${endpoint} -> ${res.status}: ${text.slice(0, 400)}`);
    }
    return res.json() as Promise<T>;
  }
  throw new Error(`${method} ${endpoint}: agotados los reintentos`);
}
