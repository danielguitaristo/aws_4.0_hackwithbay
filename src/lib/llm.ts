// Mistral client (owner A). Server-only: reads MISTRAL_API_KEY from .env.local.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Mistral } from "@mistralai/mistralai";

const DEFAULT_MODEL = "mistral-small-latest";
const EMBED_MODEL = "mistral-embed";

let client: Mistral | null = null;

export function hasMistral(): boolean {
  return Boolean(process.env.MISTRAL_API_KEY);
}

function getClient(): Mistral {
  if (!process.env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY is not set");
  client ??= new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
  return client;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/**
 * Calls Mistral in JSON mode and returns the parsed object after `validate`.
 * `validate` must throw on bad shape; we retry once with the error fed back.
 */
export async function chatJSON<T>(
  messages: ChatMessage[],
  validate: (raw: unknown) => T,
  opts: { temperature?: number; retries?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 1;
  const history: { role: "system" | "user" | "assistant"; content: string }[] = [...messages];
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await getClient().chat.complete({
      model: process.env.MISTRAL_MODEL || DEFAULT_MODEL,
      messages: history,
      responseFormat: { type: "json_object" },
      temperature: opts.temperature ?? 0.2,
    });
    const content = res.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : (content ?? []).map((c) => ("text" in c ? c.text : "")).join("");
    try {
      return validate(JSON.parse(text));
    } catch (err) {
      lastError = err;
      console.warn(`[llm] invalid JSON on attempt ${attempt + 1}: ${String(err)}`);
      history.push({ role: "assistant", content: text });
      history.push({ role: "user", content: `Invalid JSON for the requested schema: ${String(err)}. Return corrected JSON only.` });
    }
  }
  throw new Error(`Mistral returned invalid JSON: ${String(lastError)}`);
}

/** Mistral embeddings (used by the retrieval fallback). */
export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const res = await getClient().embeddings.create({ model: EMBED_MODEL, inputs: texts.slice(i, i + 32) });
    for (const d of res.data) out.push(d.embedding ?? []);
  }
  return out;
}

// Small validation helpers so callers don't need a schema library.
export function asString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new Error(`${field} must be a string`);
  return v;
}

export function asStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`${field} must be an array of strings`);
  return v;
}

export function asNumber(v: unknown, field: string, min = -Infinity, max = Infinity): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || Number.isNaN(n)) throw new Error(`${field} must be a number`);
  return Math.min(max, Math.max(min, n));
}

export function asObject(v: unknown, field: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${field} must be an object`);
  return v as Record<string, unknown>;
}

// ---- Live-call gate -------------------------------------------------------
// The deployed site is public. Routes serve cached results first; a live
// Mistral/Tavily/Moss call only runs on a cache miss, under a per-IP limit and a global
// cap (in memory, per server instance). The cached DEMO_DOMAINE run never calls a paid API.

const RATE_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
// Configurable caps: LIVE_IP_MAX live calls per IP per 10 min (default 10), LIVE_GLOBAL_MAX per hour for
// all visitors together (default 20). Each scope has its own counters, so /api/icp never uses the discover cap.
const ipMax = () => Number(process.env.LIVE_IP_MAX) || 10;
const globalMax = () => Number(process.env.LIVE_GLOBAL_MAX) || 20;
const hits = new Map<string, number[]>(); // "scope:ip" -> timestamps
const globalHits = new Map<string, number[]>(); // scope -> timestamps

export type LiveGate = { live: true } | { live: false; reason: string; status?: number };
export type LiveScope = "discover" | "icp";

export function liveGate(req: Request, scope: LiveScope = "discover"): LiveGate {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const key = `${scope}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= ipMax()) return { live: false, reason: "rate limit reached, try again in a few minutes", status: 429 };
  const global = (globalHits.get(scope) ?? []).filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (global.length >= globalMax()) return { live: false, reason: `global cap of ${globalMax()} live ${scope} runs per hour reached`, status: 429 };
  global.push(now);
  globalHits.set(scope, global);
  recent.push(now);
  hits.set(key, recent);
  return { live: true };
}

// ---- JSON file cache (data/cache) ----------------------------------------
// Read-only filesystems (serverless deploys) just skip the write.

const CACHE_ROOT = path.join(process.cwd(), "data", "cache");

export function cacheKey(value: unknown): string {
  return crypto.createHash("sha1").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);
}

export function readCache<T>(dir: string, key: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_ROOT, dir, `${key}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeCache(dir: string, key: string, data: unknown): void {
  try {
    fs.mkdirSync(path.join(CACHE_ROOT, dir), { recursive: true });
    fs.writeFileSync(path.join(CACHE_ROOT, dir, `${key}.json`), JSON.stringify(data, null, 1));
  } catch (err) {
    console.warn(`[cache] could not write ${dir}/${key}: ${String(err)}`);
  }
}
