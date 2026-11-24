// POST /api/discover — ICP -> Lead[] (owner A).
// Cached leads first (data/cache/discover/<hash(icp)>), else a rate-limited live run
// (TTB + Tavily + Moss + Mistral). Each lead also carries scoreBreakdown + portfolioDetail.
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { Domaine, ICP } from "@/lib/types";
import { DEMO_DOMAINE } from "@/lib/demo";
import { discoverLeads, permitLeads, REGIONS, type ScoredLead, type Usage } from "@/lib/discovery";
import { cacheKey, liveGate, readCache, writeCache } from "@/lib/llm";
import { trackUsage } from "@/lib/billing";
import { getDomaine, listLeads, listMessages, upsertLeads } from "@/lib/store";
import { syncStateToNeo4j } from "@/lib/graph";

export const runtime = "nodejs";
export const maxDuration = 300;

interface CachedRun {
  createdAt: string;
  leads: ScoredLead[];
}

function persistAndReply(
  leads: ScoredLead[],
  mode: "live" | "cache" | "cache-latest" | "permits" | "empty",
  reason = "",
  status = 200,
) {
  if (leads.length > 0) {
    upsertLeads(leads);
    void syncStateToNeo4j(getDomaine(), listLeads(), listMessages()).catch((err) => {
      console.warn("[api/discover] background Neo4j sync failed:", err);
    });
  }
  return NextResponse.json(leads, { status, headers: { "x-mode": mode, "x-reason": reason } });
}

/** Most recent cached run for this state (served when a live run is not possible). */
function latestRun(state: string): CachedRun | null {
  const dir = path.join(process.cwd(), "data", "cache", "discover");
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const runs = files.map((f) => readCache<CachedRun>("discover", f.replace(/\.json$/, ""))).filter((r): r is CachedRun => Boolean(r));
    return runs.filter((r) => (r.leads[0]?.state ?? "CA") === state).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // Body: { icp, domaine } for any estate, or an ICP alone (backward compatible: domaine = DEMO_DOMAINE).
  let icp: ICP;
  let domaine: Domaine = DEMO_DOMAINE;
  try {
    const body = (await req.json()) as { icp?: ICP; domaine?: Domaine } & ICP;
    icp = body?.icp ?? body;
    if (body?.icp && body.domaine) domaine = { ...body.domaine };
    delete domaine.website; // display only: never part of the engine input or the cache key
    if (!Array.isArray(icp?.portfolioFit) || typeof icp.sizeBand !== "string") throw new Error();
    if (typeof domaine?.name !== "string" || !Array.isArray(domaine.grapes) || typeof domaine.priceRangeEur?.min !== "number") throw new Error();
  } catch {
    return NextResponse.json({ error: "Body must be an ICP, or { icp: ICP, domaine: Domaine }" }, { status: 400 });
  }

  // The demo estate keeps its historical cache key (hash of the ICP); other estates hash ICP + domaine.
  const isDemo = cacheKey(domaine) === cacheKey(DEMO_DOMAINE);
  const key = isDemo ? cacheKey(icp) : cacheKey({ icp, domaine });
  const cached = readCache<CachedRun>("discover", key);
  if (cached) return persistAndReply(cached.leads, "cache");

  const state = (icp.states?.[0] ?? "CA").toUpperCase();
  if (!REGIONS[state]) return NextResponse.json({ error: `State ${state} is not supported yet` }, { status: 400 });
  // No live run possible -> this state's latest cached run, else a first pass from public TTB permits.
  const fallback = (reason: string) => {
    const latest = latestRun(state);
    return latest ? persistAndReply(latest.leads, "cache-latest", reason) : persistAndReply(permitLeads(state), "permits", reason);
  };
  const cacheOnly = process.env.TAVILY_RUN_BUDGET === "0"; // A's cache-only mode needs no keys
  if (!cacheOnly && (!process.env.TAVILY_API_KEY || !process.env.MISTRAL_API_KEY)) return fallback("TAVILY_API_KEY / MISTRAL_API_KEY not set");

  const gate = liveGate(req);
  if (!gate.live) return fallback(gate.reason ?? "rate limited");

  try {
    const budgetEnv = Number(process.env.TAVILY_RUN_BUDGET);
    const u: Usage = { searches: 0, credits: 0, budget: process.env.TAVILY_RUN_BUDGET && Number.isFinite(budgetEnv) ? budgetEnv : 60 }; // 0 = cache only
    const { leads, backend } = await discoverLeads(icp, u, domaine);
    await trackUsage("searches_run", u.searches);
    await trackUsage("leads_discovered", leads.length);
    writeCache("discover", key, { createdAt: new Date().toISOString(), leads } satisfies CachedRun);
    console.log(`[api/discover] ${leads.length} leads, ${u.searches} paid Tavily calls (${u.credits} credits), retrieval=${backend}`);
    return persistAndReply(leads, "live", `retrieval=${backend}; tavily_calls=${u.searches}; tavily_credits=${u.credits}`);
  } catch (err) {
    console.error("[api/discover] live run failed:", err);
    return fallback("live run failed, see server log");
  }
}
