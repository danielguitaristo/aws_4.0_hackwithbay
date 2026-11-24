// Demo product used all day + mock data so the UI can be built before the APIs exist.
// The domaine is fictional; in the live demo, buyers come from real discovery.
import type { Domaine, ICP, Lead, Message } from "./types";

export const DEMO_DOMAINE: Domaine = {
  name: "Domaine des Petites Pierres",
  region: "Loire Valley (Touraine)",
  appellations: ["Touraine", "Vouvray", "Chinon"],
  grapes: ["Chenin Blanc", "Cabernet Franc", "Sauvignon Blanc"],
  certifications: ["AB (organic)", "low-intervention"],
  priceRangeEur: { min: 12, max: 25 },
  annualBottles: 40000,
  currentClients: ["2 cavistes in Tours", "1 bistrot in Angers"],
  description:
    "Family-run 14 ha organic estate in Touraine. Mineral Chenin Blanc (dry & sparkling), " +
    "light Cabernet Franc reds served chilled. No sales team; sells mostly at the cellar door. " +
    "Wants independent wine shops and natural-wine bistros in Paris and Lyon.",
};

/** Used when no MISTRAL_API_KEY is set, so the UI always works. */
export const FALLBACK_ICP: ICP = {
  buyerTypes: ["caviste", "bar_a_vin", "restaurant"],
  nafCodes: ["47.25Z", "56.30Z", "56.10A"],
  cities: ["Paris", "Lyon"],
  departements: ["75", "69"],
  sizeBand: "Independent, 1-10 employees",
  personas: ["Gérant / owner", "Chef sommelier", "Wine buyer"],
  priceBand: "Shelf price €18-45 (ex-cellar €12-25)",
  triggers: [
    "New shop or bistro opened in the last 18 months",
    "Hiring a sommelier or caviste",
    "Natural / organic wine focus on website or Instagram",
    "Already lists other Loire organic producers",
  ],
  negativeSignals: ["National chains (Nicolas, V and B)", "Closed / liquidated companies", "Premium-only Bordeaux/Burgundy focus"],
  confidence: { buyerTypes: 0.9, nafCodes: 0.95, cities: 0.85, sizeBand: 0.8, personas: 0.75, priceBand: 0.7, triggers: 0.65 },
  expansions: [
    { id: "exp1", segment: "Épiceries fines in Paris", rationale: "Stock small-producer organic wine at the €15-30 shelf price.", status: "suggested" },
    { id: "exp2", segment: "Boutique hotels in the Loire Valley", rationale: "Local-sourcing story for wine-tourism guests.", status: "suggested" },
    { id: "exp3", segment: "Natural-wine importers (Belgium, Denmark)", rationale: "Strong demand for organic Loire Chenin in Northern Europe.", status: "suggested" },
  ],
};

// Fictional buyers for UI work only. Do not show these as real leads in the demo.
export const MOCK_LEADS: Lead[] = [
  {
    id: "mock1", name: "Cave Exemple Oberkampf", type: "caviste", city: "Paris", fitScore: 88, tier: "A",
    contact: { name: "Julie Martin", role: "Gérante", email: "julie@cave-exemple.fr", emailStatus: "valid" },
    signals: ["Opened in 2025", "Natural-wine focus on Instagram"],
    sources: [{ url: "https://example.com/cave-exemple", title: "Cave Exemple", snippet: "Natural wines from small Loire producers." }],
    stage: "matched", enriched: true,
  },
  {
    id: "mock2", name: "Bistrot Exemple", type: "restaurant", city: "Lyon", fitScore: 64, tier: "B",
    contact: { name: "Hugo Bernard", role: "Chef sommelier" },
    signals: ["Hiring a sommelier"],
    sources: [{ url: "https://example.com/bistrot-exemple", title: "Bistrot Exemple", snippet: "Job post: sommelier wanted." }],
    stage: "contacted", enriched: false,
  },
  {
    id: "mock3", name: "Le Bar à Vin Exemple", type: "bar_a_vin", city: "Paris", fitScore: 42, tier: "C",
    signals: [], sources: [{ url: "https://example.com/bar-exemple", snippet: "Wine bar, Bordeaux focus." }],
    stage: "matched", enriched: false,
  },
];

export const MOCK_MESSAGES: Message[] = [
  {
    id: "msg1", leadId: "mock1", channel: "email", variant: "A", status: "pending", createdAt: "2026-11-24T12:00:00Z",
    subject: "Chenin bio de Touraine pour votre cave ?",
    body: "Bonjour Julie,\n\nJ'ai vu que vous mettez en avant des vins nature de petits producteurs de Loire. Puis-je vous envoyer deux bouteilles de notre Chenin à déguster ?\n\nBien à vous,\nDomaine des Petites Pierres",
  },
];
