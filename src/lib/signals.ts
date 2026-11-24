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

const PORTFOLIO_QUERY = '"{name}" producers portfolio France Loire';

export const SIGNALS: SignalDef[] = [
  // Positive
  {
    id: "portfolio_hole",
    label: "Portfolio hole: imports Loire growers but none from Touraine/Vouvray",
    polarity: "positive",
    weight: 30,
    query: PORTFOLIO_QUERY,
    // Computed in discovery.ts: >=1 and <10 Loire producers, none from Touraine/Vouvray, >=10 producers read.
    instruction:
      "The importer's book lists at least one Loire Valley producer (Loire appellations: Muscadet, Anjou, Saumur, Chinon, Bourgueil, Sancerre, Pouilly-Fumé, Montlouis, Cheverny...) and NO producer from Touraine or Vouvray. Quote the Loire producer/appellation.",
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
    label: "TTB COLA label approvals for Loire wines",
    polarity: "positive",
    weight: 15,
    instruction: "TTB COLA label approvals for Loire wines under this importer.",
    source: "ttb",
    enabled: false, // COLA registry has no API/bulk export; skipped for the hackathon
  },
  {
    id: "neighbor_regions",
    label: "Already imports from neighboring French regions",
    polarity: "positive",
    weight: 10,
    query: PORTFOLIO_QUERY,
    instruction: "The importer carries producers from French regions near the Loire or with similar styles: Burgundy (Bourgogne), Beaujolais, Jura, Savoie, Champagne, Alsace, or Bordeaux small growers.",
    source: "portfolio",
    enabled: true,
  },
  {
    id: "tastings_fairs",
    label: "Runs portfolio tastings or attends trade / natural wine fairs",
    polarity: "positive",
    weight: 10,
    query: '"{name}" portfolio tasting trade fair',
    instruction: "The importer hosts portfolio/trade tastings or attends wine fairs (e.g. RAW, Real Wine Fair, La Dive Bouteille, Salon des Vins de Loire, Wine Paris).",
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
    label: "Imports Loire peers (lookalike growers) but no Touraine/Vouvray",
    polarity: "positive",
    weight: 25,
    instruction: "Computed: the importer carries at least one peer grower (organic / low-intervention Anjou, Saumur, Chinon, Bourgueil...) and no producer from Touraine/Vouvray/Montlouis, seen on its site, a peer's page or a CA shop page.",
    source: "portfolio",
    enabled: true,
  },
  // Negative
  {
    id: "peer_touraine",
    label: "Already imports a direct peer from Touraine/Vouvray",
    polarity: "negative",
    weight: 20,
    instruction: "Computed: a Touraine / Vouvray / Montlouis peer grower is imported by this company (its site, the peer's page or a CA shop page says so).",
    source: "portfolio",
    enabled: true,
  },
  {
    id: "loire_saturated",
    label: "Loire saturated (10+ Loire producers already)",
    polarity: "negative",
    weight: 30,
    query: PORTFOLIO_QUERY,
    instruction: "The importer's book already lists 10 or more distinct Loire Valley producers. Quote the list or the count.",
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
    label: "Already carries a similar organic Chenin from Touraine/Vouvray",
    polarity: "negative",
    weight: 20,
    query: PORTFOLIO_QUERY,
    instruction: "The importer already lists a producer from Vouvray, Montlouis or Touraine making Chenin Blanc (especially organic). Quote it.",
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

export const ACTIVE_SIGNALS = SIGNALS.filter((s) => s.enabled);
export const WEB_SIGNALS = ACTIVE_SIGNALS.filter((s) => s.source === "web");

export const signalPoints = (s: SignalDef) => (s.polarity === "positive" ? s.weight : -s.weight);

/** Distinct Tavily queries for a company (signals sharing a template share a search). */
export function signalQueries(name: string): string[] {
  const clean = name.replace(/\s+(LLC|INC)$/i, "");
  return [...new Set(ACTIVE_SIGNALS.flatMap((s) => (s.query ? [s.query.replaceAll("{name}", clean)] : [])))];
}

export const TIER_A = 60;
export const TIER_B = 35;

/** fitScore = sum of fired signal points, clamped to 0..100. */
export function scoreHits(hits: SignalHit[]): { fitScore: number; tier: "A" | "B" | "C" } {
  const fitScore = Math.max(0, Math.min(100, hits.reduce((sum, h) => sum + h.points, 0)));
  return { fitScore, tier: fitScore >= TIER_A ? "A" : fitScore >= TIER_B ? "B" : "C" };
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
