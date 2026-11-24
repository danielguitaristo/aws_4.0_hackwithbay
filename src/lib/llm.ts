// Mistral client (owner A). Server-only: reads MISTRAL_API_KEY from .env.local.
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
// The deployed site is public. Live Mistral/Tavily/Moss calls only run when the
// request carries the DEMO_PASSWORD (header "x-demo-password") and stays under
// a small per-IP rate limit. Otherwise routes serve cached / fallback data.

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
const hits = new Map<string, number[]>();

export type LiveGate = { live: true } | { live: false; reason: string; status?: number };

export function liveGate(req: Request): LiveGate {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return { live: false, reason: "DEMO_PASSWORD not set on server" };
  if (req.headers.get("x-demo-password") !== password) return { live: false, reason: "no or wrong demo password" };

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return { live: false, reason: "rate limit reached, try again in a few minutes", status: 429 };
  recent.push(now);
  hits.set(ip, recent);
  return { live: true };
}
