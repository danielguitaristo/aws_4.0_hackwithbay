// Retrieval (owner A): page chunks indexed in Moss, queried per candidate.
// Fallback (only if Moss errors): in-memory cosine search over Mistral embeddings, same signature.
import crypto from "node:crypto";
import { MossClient, type DocumentInfo } from "@inferedge/moss";
import { embed } from "./llm";
import type { WebPage } from "./discovery";

export interface Snippet {
  id: string;
  candidateId: string;
  url: string;
  title: string;
  text: string;
  score: number;
  ownSite: boolean; // chunk comes from the candidate's own website
}

const INDEX_PREFIX = "winegtm-pages-";
const CHUNK = 900;
const OVERLAP = 120;

/** Splits page text into overlapping chunks, cut on whitespace. */
function chunk(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  for (let start = 0; start < clean.length; ) {
    let end = Math.min(clean.length, start + CHUNK);
    if (end < clean.length) {
      const space = clean.lastIndexOf(" ", end);
      if (space > start + CHUNK / 2) end = space;
    }
    out.push(clean.slice(start, end));
    if (end >= clean.length) break;
    start = end - OVERLAP;
  }
  return out;
}

function toDocs(pages: WebPage[]): DocumentInfo[] {
  return pages.flatMap((p) =>
    chunk(p.text).map((text, i) => ({
      id: `${p.candidateId}:${crypto.createHash("sha1").update(p.url).digest("hex").slice(0, 8)}:${i}`,
      text,
      metadata: { candidateId: p.candidateId, url: p.url, title: p.title || "", ownSite: p.ownSite ? "1" : "0" },
    })),
  );
}

let moss: MossClient | null = null;
function mossClient(): MossClient {
  if (!process.env.MOSS_PROJECT_ID || !process.env.MOSS_PROJECT_KEY) throw new Error("MOSS_PROJECT_ID / MOSS_PROJECT_KEY not set");
  moss ??= new MossClient(process.env.MOSS_PROJECT_ID, process.env.MOSS_PROJECT_KEY);
  return moss;
}

/** A searchable index over a set of pages. Build once per discovery run, then query per candidate. */
export interface PageIndex {
  backend: "moss" | "mistral";
  query(candidateId: string, queries: string[], topK?: number): Promise<Snippet[]>;
}

/**
 * Indexes every page chunk in Moss (index name = content hash, so unchanged content is not re-indexed).
 * Falls back to Mistral embeddings in memory if Moss is unavailable.
 */
export async function buildIndex(pages: WebPage[]): Promise<PageIndex> {
  const docs = toDocs(pages);
  try {
    return await mossIndex(docs);
  } catch (err) {
    console.error("[retrieval] Moss failed, falling back to Mistral embeddings:", err);
    return mistralIndex(docs);
  }
}

async function mossIndex(docs: DocumentInfo[]): Promise<PageIndex> {
  const client = mossClient();
  const hash = crypto.createHash("sha1").update(docs.map((d) => `${d.id}:${d.text.length}:${d.metadata?.ownSite}`).join("|")).digest("hex").slice(0, 12);
  const name = `${INDEX_PREFIX}${hash}`;

  const existing = await client.listIndexes();
  if (!existing.some((i) => i.name === name && i.status === "Ready")) {
    if (existing.some((i) => i.name === name)) await client.deleteIndex(name); // failed / partial build
    await client.createIndex(name, docs);
    // Keep the project tidy: drop older page indexes.
    for (const old of existing.filter((i) => i.name.startsWith(INDEX_PREFIX) && i.name !== name)) await client.deleteIndex(old.name).catch(() => false);
  }
  await client.loadIndex(name);

  return {
    backend: "moss",
    async query(candidateId, queries, topK = 3) {
      const results = await Promise.all(
        queries.map((q) => client.query(name, q, { topK, filter: { field: "candidateId", condition: { $eq: candidateId } } })),
      );
      return dedupe(
        results.flatMap((r) =>
          r.docs.map((d) => ({
            id: d.id,
            candidateId: d.metadata?.candidateId ?? candidateId,
            url: d.metadata?.url ?? "",
            title: d.metadata?.title ?? "",
            text: d.text,
            score: d.score,
            ownSite: d.metadata?.ownSite === "1",
          })),
        ),
      ).filter((s) => s.candidateId === candidateId); // in case the filter is ignored
    },
  };
}

async function mistralIndex(docs: DocumentInfo[]): Promise<PageIndex> {
  const vectors = await embed(docs.map((d) => d.text));
  const cos = (a: number[], b: number[]) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) (dot += a[i] * b[i]), (na += a[i] * a[i]), (nb += b[i] * b[i]);
    return dot / (Math.sqrt(na * nb) || 1);
  };
  return {
    backend: "mistral",
    async query(candidateId, queries, topK = 3) {
      const own = docs.map((d, i) => ({ d, v: vectors[i] })).filter((x) => x.d.metadata?.candidateId === candidateId);
      const qv = await embed(queries);
      return dedupe(
        qv.flatMap((q) =>
          own
            .map(({ d, v }) => ({ id: d.id, candidateId, url: d.metadata?.url ?? "", title: d.metadata?.title ?? "", text: d.text, score: cos(q, v), ownSite: d.metadata?.ownSite === "1" }))
            .sort((a, b) => b.score - a.score)
            .slice(0, topK),
        ),
      );
    },
  };
}

function dedupe(snippets: Snippet[]): Snippet[] {
  const best = new Map<string, Snippet>();
  for (const s of snippets) if (!best.has(s.id) || best.get(s.id)!.score < s.score) best.set(s.id, s);
  return [...best.values()].sort((a, b) => b.score - a.score);
}
