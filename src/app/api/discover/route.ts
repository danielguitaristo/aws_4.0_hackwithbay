// POST /api/discover — ICP -> Lead[] (owner A).
// Cached leads first (data/cache/discover/<hash(icp)>), else a rate-limited live run
// (TTB + Tavily + Moss + Mistral). Each lead also carries scoreBreakdown + portfolioDetail.
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { ICP } from "@/lib/types";
import { discoverLeads, type ScoredLead, type Usage } from "@/lib/discovery";
import { cacheKey, liveGate, readCache, writeCache } from "@/lib/llm";
import { trackUsage } from "@/lib/billing";

export const runtime = "nodejs";
export const maxDuration = 300;

interface CachedRun {
  createdAt: string;
  leads: ScoredLead[];
}

function reply(leads: ScoredLead[], mode: "live" | "cache" | "cache-latest" | "empty", reason = "", status = 200) {
  return NextResponse.json(leads, { status, headers: { "x-mode": mode, "x-reason": reason } });
}

/** Most recent cached run for any ICP (served when a live run is not possible). */
function latestRun(): CachedRun | null {
  const dir = path.join(process.cwd(), "data", "cache", "discover");
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const runs = files.map((f) => readCache<CachedRun>("discover", f.replace(/\.json$/, ""))).filter((r): r is CachedRun => Boolean(r));
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let icp: ICP;
  try {
    icp = (await req.json()) as ICP;
    if (!Array.isArray(icp?.portfolioFit) || typeof icp.sizeBand !== "string") throw new Error();
  } catch {
    return NextResponse.json({ error: "Body must be an ICP JSON object" }, { status: 400 });
  }

  const key = cacheKey(icp);
  const cached = readCache<CachedRun>("discover", key);
  if (cached) return reply(cached.leads, "cache");

  const gate = liveGate(req);
  if (!gate.live) {
    const latest = latestRun();
    return latest ? reply(latest.leads, "cache-latest", gate.reason) : reply([], "empty", gate.reason, gate.status);
  }

  try {
    const budgetEnv = Number(process.env.TAVILY_RUN_BUDGET);
    const u: Usage = { searches: 0, credits: 0, budget: process.env.TAVILY_RUN_BUDGET && Number.isFinite(budgetEnv) ? budgetEnv : 60 }; // 0 = cache only
    const { leads, backend } = await discoverLeads(icp, u);
    await trackUsage("searches_run", u.searches);
    await trackUsage("leads_discovered", leads.length);
    writeCache("discover", key, { createdAt: new Date().toISOString(), leads } satisfies CachedRun);
    console.log(`[api/discover] ${leads.length} leads, ${u.searches} paid Tavily calls (${u.credits} credits), retrieval=${backend}`);
    return reply(leads, "live", `retrieval=${backend}; tavily_calls=${u.searches}; tavily_credits=${u.credits}`);
  } catch (err) {
    console.error("[api/discover] live run failed:", err);
    const latest = latestRun();
    return latest ? reply(latest.leads, "cache-latest", "live run failed, see server log") : reply([], "empty", "live run failed, see server log", 500);
  }
}
