// Demo product used all day + mock data so the UI can be built before the APIs exist.
// The domaine is fictional; in the live demo, importers come from real public permit data.
import type { Domaine, ICP, Lead, Message } from "./types";

export const DEMO_DOMAINE: Domaine = {
  name: "Domaine des Petites Pierres",
  region: "Loire Valley (Touraine)",
  appellations: ["Touraine", "Vouvray", "Chinon"],
  grapes: ["Chenin Blanc", "Cabernet Franc", "Sauvignon Blanc"],
  certifications: ["AB (organic)", "low-intervention"],
  priceRangeEur: { min: 9, max: 22 },
  annualBottles: 40000,
  exportBottles: 6000,
  currentExport: ["Belgium (1 importer)", "Denmark (1 importer)"],
  targetStates: ["CA"],
  description:
    "Family-run 14 ha organic estate in Touraine. Mineral Chenin Blanc (dry & sparkling), " +
    "light Cabernet Franc reds served chilled. No export team; wants a first US importer, " +
    "ideally a California importer-distributor focused on small natural-wine growers.",
};

/** Used when no MISTRAL_API_KEY is set, so the UI always works. */
export const FALLBACK_ICP: ICP = {
  buyerTypes: ["importer_distributor", "importer"],
  naicsCodes: ["424820"],
  states: ["CA"],
  metros: ["San Francisco Bay Area", "Los Angeles"],
  sizeBand: "Boutique, 2-30 employees, 20-150 producers in portfolio",
  personas: ["Founder / owner", "Portfolio director / buyer"],
  portfolioFit: ["French natural / organic wine", "Small family growers", "Loire Valley"],
  priceBand: "US shelf price $25-55",
  triggers: [
    "Already imports Loire growers but no Vouvray / Touraine",
    "Recently issued importer or wholesaler license",
    "Hiring sales reps or expanding to a new state",
    "Holds both importer and wholesaler permits (sells direct to CA shops & restaurants)",
  ],
  negativeSignals: ["National mega-distributors (500+ brands)", "Spirits-only or beer-only permits", "Bordeaux/Burgundy grand-cru focus"],
  confidence: { buyerTypes: 0.9, naicsCodes: 0.95, states: 0.9, metros: 0.8, sizeBand: 0.7, personas: 0.75, portfolioFit: 0.8, priceBand: 0.65, triggers: 0.7 },
  expansions: [
    { id: "exp1", segment: "New York natural-wine importers", rationale: "Second-largest US market for French natural wine.", status: "suggested" },
    { id: "exp2", segment: "Wine clubs with import licenses", rationale: "Buy small lots, value the grower story.", status: "suggested" },
    { id: "exp3", segment: "Restaurant groups that import directly", rationale: "Some CA groups hold importer permits for exclusives.", status: "suggested" },
  ],
};

// Fictional importers for UI work only. Do not show these as real leads in the demo.
export const MOCK_LEADS: Lead[] = [
  {
    id: "mock1", name: "Example Selections", type: "importer_distributor", state: "CA", city: "Oakland", fitScore: 89, tier: "A",
    permits: [{ source: "TTB", number: "CA-I-00000", kind: "importer" }, { source: "TTB", number: "CA-W-00000", kind: "wholesaler" }],
    portfolio: ["Loire (4 growers)", "Beaujolais", "Jura"],
    contact: { name: "Sam Rivera", role: "Founder", email: "sam@example-selections.com", emailStatus: "valid" },
    signals: ["Imports 4 Loire growers, none from Vouvray", "Sells direct to Bay Area shops"],
    sources: [{ url: "https://example.com/example-selections", title: "Example Selections — Producers", snippet: "Small growers from the Loire, Beaujolais and Jura." }],
    stage: "matched", enriched: true,
  },
  {
    id: "mock2", name: "Sample Wine Imports", type: "importer", state: "CA", city: "Los Angeles", fitScore: 66, tier: "B",
    permits: [{ source: "TTB", number: "CA-I-00001", kind: "importer", issuedAt: "2026-06-01" }],
    portfolio: ["Rhône", "Languedoc"],
    contact: { name: "Alex Chen", role: "Portfolio buyer" },
    signals: ["Importer permit issued 2026", "Hiring a sales rep"],
    sources: [{ url: "https://example.com/sample-imports", title: "Sample Wine Imports", snippet: "Job post: California sales representative." }],
    stage: "contacted", enriched: false,
  },
  {
    id: "mock3", name: "Demo Beverage Distributors", type: "distributor", state: "CA", city: "Sacramento", fitScore: 38, tier: "C",
    permits: [{ source: "CA_ABC", number: "000000", kind: "wholesaler" }],
    portfolio: ["Bordeaux", "Napa"],
    signals: [], sources: [{ url: "https://example.com/demo-bev", snippet: "Large portfolio, Bordeaux focus." }],
    stage: "matched", enriched: false,
  },
];

export const MOCK_MESSAGES: Message[] = [
  {
    id: "msg1", leadId: "mock1", channel: "email", variant: "A", status: "pending", createdAt: "2026-11-24T12:00:00Z",
    subject: "Organic Vouvray for your Loire book?",
    body: "Hi Sam,\n\nI saw you carry four Loire growers but no Vouvray yet. We're a 14 ha organic family estate in Touraine making mineral Chenin Blanc, still and sparkling, and we're looking for our first US partner.\n\nCould I send you two sample bottles?\n\nBest,\nDomaine des Petites Pierres",
  },
];
