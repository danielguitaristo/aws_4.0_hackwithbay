// Fit signals (owner A): drive both the per-candidate Tavily searches and the fitScore.
// Edit weights / queries here; discovery and /api/discover read this list.
import type { ScoreItem } from "./types";

export interface SignalDef {
  id: string;
  label: string;
  polarity: "positive" | "negative";
  weight: number; // points added (positive) or removed (negative)
  /** Tavily query template, {name} = company name. Signals sharing a template share one search. */
  query?: string;
  /** What Mistral must find in the snippets for the signal to fire. */
  instruction: string;
  /**
   * "web" = detected by Mistral in retrieved snippets; "portfolio" = computed by code from the
   * structured portfolio extracted from the importer's own site; "ttb" = from the permit file.
   */
  source: "web" | "portfolio" | "ttb";
  enabled: boolean;
}

/** A fired (or unknown / info) signal with its evidence, shown in the UI as "Tier A because...". */
export type SignalHit = ScoreItem;

const PORTFOLIO_QUERY = '"{name}" producers portfolio France {region}';

export const SIGNALS: SignalDef[] = [
  // Positive
  {
    id: "portfolio_hole",
    label: "Portfolio hole: imports {region} growers but none from {ours}",
    polarity: "positive",
    weight: 30,
    query: PORTFOLIO_QUERY,
    // Computed in discovery.ts from the structured portfolio (region / appellations come from the estate profile).
    instruction:
      "The importer's book lists at least one {region} producer ({region} appellations: {peers}...) and NO producer from {ours}. Quote the {region} producer/appellation.",
    source: "portfolio",
    enabled: true,
  },
  {
    id: "grower_philosophy",
    label: "Small family / grower / low-intervention philosophy",
    polarity: "positive",
    weight: 20,
    query: '"{name}" family growers organic natural wine',
    instruction: 'The importer describes its own focus with words like "grower", "family estate", "natural", "organic", "biodynamic", "low-intervention", "small producers".',
    source: "web",
    enabled: true,
  },
  {
    id: "boutique_size",
    label: "Boutique size (≈10-150 producers), fits a ~500-case first order",
    polarity: "positive",
    weight: 15,
    query: PORTFOLIO_QUERY,
    instruction: "A snippet explicitly states the importer is small: a stated number of producers between about 10 and 150, a small team, or 'boutique'/'small' wording about the company. A list of producer names is NOT evidence.",
    source: "web",
    enabled: true,
  },
  {
    id: "cola_loire",
    label: "TTB COLA label approvals for {region} wines",
    polarity: "positive",
    weight: 15,
    instruction: "TTB COLA label approvals for {region} wines under this importer.",
    source: "ttb",
    enabled: false, // COLA registry has no API/bulk export; skipped for the hackathon
  },
  {
    id: "neighbor_regions",
    label: "Already imports from neighboring French regions",
    polarity: "positive",
    weight: 10,
    query: PORTFOLIO_QUERY,
    instruction: "The importer carries producers from French regions near {region} or with similar styles: {neighbors}.",
    source: "portfolio",
    enabled: true,
  },
  {
    id: "tastings_fairs",
    label: "Runs portfolio tastings or attends trade / natural wine fairs",
    polarity: "positive",
    weight: 10,
    query: '"{name}" portfolio tasting trade fair',
    instruction: "The importer hosts portfolio/trade tastings or attends wine fairs (e.g. RAW, Real Wine Fair, La Dive Bouteille, Salon des Vins de {region}, Wine Paris).",
    source: "web",
    enabled: true,
  },
  {
    id: "price_match",
    label: "Shelf price range $25-55 matches",
    polarity: "positive",
    weight: 10,
    // Computed in discovery.ts: prices seen (site or CA shops) vs estimateShelfPrice() below.
    instruction: "A snippet shows a retail bottle price in USD for a French wine this importer sells. The quote MUST contain that dollar price.",
    source: "web",
    enabled: true,
  },
  {
    id: "recent_or_hiring",
    label: "New permit, or hiring sales reps / expanding to new states",
    polarity: "positive",
    weight: 10,
    query: '"{name}" hiring sales representative',
    instruction: "A snippet explicitly says the importer is hiring (job post, 'we are hiring', open sales position) or announces expansion into a new state/market. Contact pages, 'find your rep' and someone's current job title are NOT evidence.",
    source: "web",
    enabled: true,
  },
  {
    id: "peer_neighbors",
    label: "Imports {region} peers (lookalike growers) but no {ours}",
    polarity: "positive",
    weight: 25,
    instruction: "Computed: the importer carries at least one peer grower (organic / low-intervention {peers}...) and no producer from {area}, seen on its site, a peer's page or a CA shop page.",
    source: "portfolio",
    enabled: true,
  },
  // Negative
  {
    id: "peer_touraine",
    label: "Already imports a direct peer from {ours}",
    polarity: "negative",
    weight: 20,
    instruction: "Computed: a {area} peer grower is imported by this company (its site, the peer's page or a CA shop page says so).",
    source: "portfolio",
    enabled: true,
  },
  {
    id: "loire_saturated",
    label: "{region} saturated (2+ estates from the same appellation: {ours})",
    polarity: "negative",
    weight: 30,
    query: PORTFOLIO_QUERY,
    instruction: "Computed: the importer's book already lists 2 or more estates from one of our appellations ({ours}).",
    source: "portfolio",
    enabled: true,
  },
  {
    id: "mega_distributor",
    label: "Mega-distributor or high minimum volumes (national brands, 500+ SKUs)",
    polarity: "negative",
    weight: 30,
    instruction: "A snippet explicitly states national scale: 500+ SKUs/products, distribution in many states, 'one of the largest', national brands, or high minimum volumes. A list of producers is NOT evidence.",
    source: "web",
    enabled: true,
  },
  {
    id: "spirits_beer_only",
    label: "Spirits-only or beer-only",
    polarity: "negative",
    weight: 30,
    instruction: "The company only deals in spirits, beer, sake or cider, with no wine.",
    source: "web",
    enabled: true,
  },
  {
    id: "similar_chenin",
    label: "Already carries a similar {grape} from {ours}",
    polarity: "negative",
    weight: 20,
    query: PORTFOLIO_QUERY,
    instruction: "Computed: the importer already lists a producer from {area} making {grape}.",
    source: "portfolio",
    enabled: true,
  },
  {
    id: "big_houses",
    label: "Focus on big houses / Bordeaux-Burgundy grand cru",
    polarity: "negative",
    weight: 15,
    instruction: "A snippet explicitly says the importer's focus is famous houses, classified-growth Bordeaux, Burgundy grand cru or luxury/allocated wines. A list that merely includes some famous names is NOT evidence.",
    source: "web",
    enabled: true,
  },
];

/** Values from the estate profile that fill the {placeholders} of labels, instructions and queries. */
export interface SignalVars {
  region: string;
  ours: string;
  area: string;
  peers: string;
  grape: string;
  neighbors?: string;
}

const TEMPLATES = new Map<string, { label: string; instruction: string; query?: string }>();

/** Renders every signal's texts for the current estate (templates are kept from the first call). */
export function applySignalProfile(v: SignalVars) {
  const fill = (x: string) =>
    x.replaceAll("{region}", v.region).replaceAll("{ours}", v.ours).replaceAll("{area}", v.area).replaceAll("{peers}", v.peers).replaceAll("{grape}", v.grape).replaceAll("{neighbors}", v.neighbors ?? "");
  for (const s of SIGNALS) {
    if (!TEMPLATES.has(s.id)) TEMPLATES.set(s.id, { label: s.label, instruction: s.instruction, query: s.query });
    const t = TEMPLATES.get(s.id)!;
    s.label = fill(t.label);
    s.instruction = fill(t.instruction);
    if (t.query) s.query = fill(t.query);
  }
}

export const ACTIVE_SIGNALS = SIGNALS.filter((s) => s.enabled);
export const WEB_SIGNALS = ACTIVE_SIGNALS.filter((s) => s.source === "web");

export const signalPoints = (s: SignalDef) => (s.polarity === "positive" ? s.weight : -s.weight);

/** Distinct Tavily queries for a company (signals sharing a template share a search). */
export function signalQueries(name: string): string[] {
  const clean = name.replace(/\s+(LLC|INC)$/i, "");
  return [...new Set(ACTIVE_SIGNALS.flatMap((s) => (s.query ? [s.query.replaceAll("{name}", clean)] : [])))];
}

/*
 * Two sub-scores (team decision 2026-11-24), each 0-100, shown as "info" items in scoreBreakdown:
 *   Fit     = does their book look like our wine (organic/natural, small growers, our region, price, neighbors)
 *   Opening = is there room for our wine (none of our appellations yet, small enough, hiring, tastings)
 *   fitScore = 0.6 x Fit + 0.4 x Opening;  A >= 60, B >= 40, C below.
 * Rules:
 *   - Strong presence in our region (>= 5 producers) WITHOUT our appellation = "region specialist", +15 Fit.
 *   - "Saturated" (-30 Opening) only with 2+ estates from the SAME appellation as ours (estate profile).
 *   - Direct competitor (same appellation): -20 Opening if same style (dry/sweet/sparkling) AND similar price
 *     (within our estimated shelf range +/-20%), -5 if different style (or same style, different price),
 *     "unknown" if style or price is not found on the page.
 *   - Absence claims (none of our appellations) need coverage OK or a full region page, else "unknown".
 *   - recent_or_hiring: a hiring post needs a date in the last 12 months AND a named role; LinkedIn profile
 *     activity (undated) never counts. A TTB "new permit" flag counts (dated by the weekly TTB list).
 */
export const SUBSCORE_WEIGHTS = {
  fit: { organicNatural: 25, smallGrowers: 20, loirePresence: 20, loireSpecialist: 15, priceOverlap: 10, neighborRegions: 10, bigHouses: -15, spiritsOnly: -30 },
  opening: { room: 35, boutique: 25, hiringOrNewPermit: 20, tastings: 20, saturated: -30, directCompetitor: -20, sameAppellationOtherStyle: -5, megaDistributor: -30 },
  blend: { fit: 0.6, opening: 0.4 },
  loireSpecialistMin: 5, // producers from our region needed to call an importer a region specialist
  saturatedMin: 2, // estates from the same appellation as ours
  priceTolerance: 0.2, // "similar price" = within the estimated shelf range +/- 20%
  hiringMaxAgeDays: 365,
} as const;

export const TIERS = { A: 60, B: 40 } as const;

/** fitScore = 0.6 x Fit + 0.4 x Opening (both clamped 0-100); A >= 60, B >= 40, C below. */
export function blendScores(fit: number, opening: number): { fit: number; opening: number; fitScore: number; tier: "A" | "B" | "C" } {
  const f = Math.max(0, Math.min(100, fit));
  const o = Math.max(0, Math.min(100, opening));
  const fitScore = Math.round(SUBSCORE_WEIGHTS.blend.fit * f + SUBSCORE_WEIGHTS.blend.opening * o);
  return { fit: f, opening: o, fitScore, tier: fitScore >= TIERS.A ? "A" : fitScore >= TIERS.B ? "B" : "C" };
}

// ---- US shelf price estimate --------------------------------------------------
// Every number below is an ASSUMPTION (hackathon defaults), editable here.

export interface PriceAssumption {
  value: number;
  label: string;
}

export const PRICE_ASSUMPTIONS = {
  eurUsd: { value: 1.08, label: "EUR→USD exchange rate (assumption)" },
  euTariff: { value: 0.15, label: "US tariff on EU wine, on ex-cellar value (assumption: 15%)" },
  freightUsd: { value: 1.5, label: "Freight, insurance & excise per bottle, USD (assumption)" },
  importerMargin: { value: 0.3, label: "Importer gross margin on its selling price (assumption: 30%)" },
  distributorMargin: { value: 0.28, label: "Distributor gross margin on its selling price (assumption: 28%)" },
  retailerMargin: { value: 0.33, label: "Retailer gross margin on shelf price (assumption: 33%)" },
} satisfies Record<string, PriceAssumption>;

/** Ex-cellar EUR -> estimated US shelf price (USD), with the calculation spelled out. */
export function estimateShelfPrice(eur: number, a = PRICE_ASSUMPTIONS): { usd: number; steps: string } {
  const fob = eur * a.eurUsd.value;
  const landed = fob * (1 + a.euTariff.value) + a.freightUsd.value;
  const importer = landed / (1 - a.importerMargin.value);
  const distributor = importer / (1 - a.distributorMargin.value);
  const shelf = distributor / (1 - a.retailerMargin.value);
  const $ = (n: number) => `$${n.toFixed(2)}`;
  return {
    usd: shelf,
    steps: `€${eur} × ${a.eurUsd.value} = ${$(fob)} → +${a.euTariff.value * 100}% tariff +${$(a.freightUsd.value)} freight = ${$(landed)} landed → importer ÷${(1 - a.importerMargin.value).toFixed(2)} = ${$(importer)} → distributor ÷${(1 - a.distributorMargin.value).toFixed(2)} = ${$(distributor)} → retailer ÷${(1 - a.retailerMargin.value).toFixed(2)} = ${$(shelf)}`,
  };
}

export function shelfRange(priceRangeEur: { min: number; max: number }) {
  const lo = estimateShelfPrice(priceRangeEur.min);
  const hi = estimateShelfPrice(priceRangeEur.max);
  const assumptions = Object.values(PRICE_ASSUMPTIONS).map((x) => x.label.replace(/ \(assumption[^)]*\)/, "") + ` = ${x.value}`).join("; ");
  return { min: Math.round(lo.usd), max: Math.round(hi.usd), calculation: `Low: ${lo.steps}. High: ${hi.steps}. Assumptions (editable in signals.ts): ${assumptions}.` };
}
