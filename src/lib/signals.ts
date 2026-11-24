// Fit signals (owner A): drive both the per-candidate Tavily searches and the fitScore.
// Edit weights / queries here; discovery and /api/discover read this list.

export interface SignalDef {
  id: string;
  label: string;
  polarity: "positive" | "negative";
  weight: number; // points added (positive) or removed (negative)
  /** Tavily query template, {name} = company name. Signals sharing a template share one search. */
  query?: string;
  /** What Mistral must find in the snippets for the signal to fire. */
  instruction: string;
  /** "web" = detected by Mistral in retrieved snippets, "ttb" = computed from the permit file. */
  source: "web" | "ttb";
  enabled: boolean;
}

/** A fired signal with its evidence (shown in the UI as "Tier A because..."). */
export interface SignalHit {
  id: string;
  label: string;
  points: number; // signed
  snippet: string; // verbatim evidence
  url: string;
  title?: string;
}

const PORTFOLIO_QUERY = '"{name}" producers portfolio France Loire';

export const SIGNALS: SignalDef[] = [
  // Positive
  {
    id: "portfolio_hole",
    label: "Portfolio hole: imports Loire growers but none from Touraine/Vouvray",
    polarity: "positive",
    weight: 30,
    query: PORTFOLIO_QUERY,
    instruction:
      "The importer's book lists at least one Loire Valley producer (Loire appellations: Muscadet, Anjou, Saumur, Chinon, Bourgueil, Sancerre, Pouilly-Fumé, Montlouis, Cheverny...) and NO producer from Touraine or Vouvray. Quote the Loire producer/appellation.",
    source: "web",
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
    instruction: "The importer is small: a stated or listable portfolio of roughly 10-150 producers, a small team, or 'boutique' wording. Do not fire for national brands.",
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
    source: "web",
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
    instruction: "Snippets show bottle prices for this importer's wines mostly between $25 and $55 (retail/shelf). Quote a price.",
    source: "web",
    enabled: true,
  },
  {
    id: "recent_or_hiring",
    label: "New permit, or hiring sales reps / expanding to new states",
    polarity: "positive",
    weight: 10,
    query: '"{name}" hiring sales representative',
    instruction: "The importer is hiring sales reps/staff, or announces expansion into new states or markets.",
    source: "web",
    enabled: true,
  },
  // Negative
  {
    id: "loire_saturated",
    label: "Loire saturated (10+ Loire producers already)",
    polarity: "negative",
    weight: 30,
    query: PORTFOLIO_QUERY,
    instruction: "The importer's book already lists 10 or more distinct Loire Valley producers. Quote the list or the count.",
    source: "web",
    enabled: true,
  },
  {
    id: "mega_distributor",
    label: "Mega-distributor or high minimum volumes (national brands, 500+ SKUs)",
    polarity: "negative",
    weight: 30,
    instruction: "The company is a large national distributor: national brands, 500+ SKUs, many states, or high minimum volumes.",
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
    source: "web",
    enabled: true,
  },
  {
    id: "big_houses",
    label: "Focus on big houses / Bordeaux-Burgundy grand cru",
    polarity: "negative",
    weight: 15,
    instruction: "The importer focuses on famous houses, classified-growth Bordeaux or Burgundy grand cru, luxury/allocated wines.",
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
