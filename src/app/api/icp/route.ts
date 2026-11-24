// POST /api/icp — Domaine -> ICP (owner A).
// Cached ICP first (data/cache/icp), else a rate-limited live Mistral call, else FALLBACK_ICP.
import { NextResponse } from "next/server";
import type { BuyerType, Domaine, Expansion, ICP } from "@/lib/types";
import { FALLBACK_ICP } from "@/lib/demo";
import { asNumber, asObject, asString, asStringArray, cacheKey, chatJSON, hasMistral, liveGate, readCache, writeCache } from "@/lib/llm";

const BUYER_TYPES: BuyerType[] = ["importer_distributor", "importer", "distributor"];
const FIELDS = ["buyerTypes", "naicsCodes", "states", "metros", "sizeBand", "personas", "portfolioFit", "priceBand", "triggers", "negativeSignals"];

function validateICP(raw: unknown): ICP {
  const o = asObject(raw, "ICP");
  const buyerTypes = asStringArray(o.buyerTypes, "buyerTypes").filter((t): t is BuyerType => BUYER_TYPES.includes(t as BuyerType));
  if (!buyerTypes.length) throw new Error(`buyerTypes must contain one of ${BUYER_TYPES.join(", ")}`);

  const conf = asObject(o.confidence, "confidence");
  const confidence: Record<string, number> = {};
  for (const f of FIELDS) if (f in conf) confidence[f] = asNumber(conf[f], `confidence.${f}`, 0, 1);

  if (!Array.isArray(o.expansions)) throw new Error("expansions must be an array");
  const expansions: Expansion[] = o.expansions.slice(0, 3).map((e, i) => {
    const x = asObject(e, `expansions[${i}]`);
    return { id: `exp${i + 1}`, segment: asString(x.segment, "segment"), rationale: asString(x.rationale, "rationale"), status: "suggested" };
  });
  if (expansions.length < 2) throw new Error("expansions needs 2-3 items");

  return {
    buyerTypes,
    naicsCodes: asStringArray(o.naicsCodes, "naicsCodes"),
    states: asStringArray(o.states, "states"),
    metros: asStringArray(o.metros, "metros"),
    sizeBand: asString(o.sizeBand, "sizeBand"),
    personas: asStringArray(o.personas, "personas"),
    portfolioFit: asStringArray(o.portfolioFit, "portfolioFit"),
    priceBand: asString(o.priceBand, "priceBand"),
    triggers: asStringArray(o.triggers, "triggers"),
    negativeSignals: asStringArray(o.negativeSignals, "negativeSignals"),
    confidence,
    expansions,
  };
}

const SYSTEM = `You help small French wine estates find their first US importer.
US three-tier system: a foreign winery must sell to a licensed US importer, then a state distributor.
"importer_distributor" = holds both federal importer and wholesaler permits and sells to retailers in-state.
Given the estate, output the ideal US buyer profile as JSON with exactly these keys:
buyerTypes (subset of ["importer_distributor","importer","distributor"]), naicsCodes (string[], e.g. "424820"),
states (2-letter codes), metros (string[]), sizeBand (string: size of the US BUYER, e.g. employees and producers in portfolio, not the estate),
personas (string[] job titles at the buyer), portfolioFit (string[]),
priceBand (string, US shelf price in USD), triggers (string[] buying signals), negativeSignals (string[]),
confidence (object: one number 0..1 per key above, how sure you are given the input),
expansions (2-3 objects {segment, rationale}: adjacent segments worth testing).
Base everything on the estate data. Do not name specific companies.`;

function reply(icp: ICP, mode: "live" | "cache" | "fallback", reason = "", status = 200) {
  return NextResponse.json(icp, { status, headers: { "x-mode": mode, "x-reason": reason } });
}

export async function POST(req: Request) {
  let domaine: Domaine;
  try {
    domaine = (await req.json()) as Domaine;
    asString(domaine?.name, "name");
    delete domaine.website; // display only: never part of the engine input or the cache key
  } catch {
    return NextResponse.json({ error: "Body must be a Domaine JSON object" }, { status: 400 });
  }

  const key = cacheKey(domaine);
  const cached = readCache<ICP>("icp", key);
  if (cached) return reply(cached, "cache");

  if (!hasMistral()) return reply(FALLBACK_ICP, "fallback", "MISTRAL_API_KEY not set");
  const gate = liveGate(req, "icp"); // own counters: never uses the discover cap
  if (!gate.live) return reply(FALLBACK_ICP, "fallback", gate.reason, gate.status);

  try {
    const icp = await chatJSON(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(domaine) },
      ],
      validateICP,
    );
    writeCache("icp", key, icp);
    return reply(icp, "live");
  } catch (err) {
    console.error("[api/icp] Mistral failed, using FALLBACK_ICP:", err);
    return reply(FALLBACK_ICP, "fallback", "Mistral error, see server log");
  }
}
