// Shared contracts. Agree on these first; change them only as a team.

export type Confidence = Record<string, number>; // field name -> 0.00..1.00

/** The French winemaker's estate, captured at intake. */
export interface Domaine {
  name: string;
  region: string;
  appellations: string[];
  grapes: string[];
  certifications: string[]; // "AB (organic)", "Demeter", "natural", ...
  priceRangeEur: { min: number; max: number }; // ex-cellar price per bottle
  annualBottles: number;
  exportBottles: number; // volume available for the US
  currentExport: string[]; // existing export markets / reference wins
  targetStates: string[]; // e.g. ["CA", "NY"]
  description: string;
}

/** US buyers of imported wine. importer_distributor = imports AND sells to retailers in-state. */
export type BuyerType = "importer_distributor" | "importer" | "distributor";

/** Ideal profile of the US importer/distributor that should carry this estate. */
export interface ICP {
  buyerTypes: BuyerType[];
  naicsCodes: string[]; // e.g. 424820 (wine & spirits merchant wholesalers)
  states: string[]; // e.g. ["CA"]
  metros: string[]; // e.g. ["San Francisco Bay Area", "Los Angeles"]
  sizeBand: string; // e.g. "Boutique, 2-30 employees, 20-150 producers in portfolio"
  personas: string[]; // e.g. "Founder / owner", "Portfolio buyer"
  portfolioFit: string[]; // what their book should look like, e.g. "French natural wine", "Loire"
  priceBand: string; // US shelf price
  triggers: string[]; // buying signals
  negativeSignals: string[];
  confidence: Confidence;
  expansions: Expansion[];
}

export interface Expansion {
  id: string;
  segment: string;
  rationale: string;
  status: "suggested" | "accepted" | "dismissed";
}

export interface Source {
  url: string;
  title?: string;
  snippet: string;
}

/** Public license record proving the buyer can legally import / distribute. */
export interface Permit {
  source: "TTB" | "CA_ABC";
  number: string;
  kind: "importer" | "wholesaler";
  issuedAt?: string;
}

export interface Contact {
  name: string;
  role: string;
  email?: string;
  emailStatus?: "valid" | "accept_all" | "unknown" | "invalid";
  linkedin?: string;
}

export type Stage = "matched" | "contacted" | "replied" | "samples_sent" | "tasting" | "signed" | "lost";
export const STAGES: Stage[] = ["matched", "contacted", "replied", "samples_sent", "tasting", "signed", "lost"];
export const STAGE_LABELS: Record<Stage, string> = {
  matched: "Matched",
  contacted: "Contacted",
  replied: "Replied",
  samples_sent: "Samples sent",
  tasting: "Tasting",
  signed: "Signed",
  lost: "Lost",
};

export interface Lead {
  id: string;
  name: string;
  type: BuyerType;
  state: string;
  city: string;
  address?: string;
  website?: string;
  permits: Permit[];
  portfolio: string[]; // French regions / producers they already import
  contact?: Contact;
  fitScore: number; // 0..100
  tier: "A" | "B" | "C";
  signals: string[];
  sources: Source[];
  stage: Stage;
  enriched: boolean;
  scoreBreakdown?: ScoreItem[]; // why this score ("Tier A because..."), filled by /api/discover
  portfolioDetail?: PortfolioItem[]; // structured portfolio read on the importer's own site
}

/** One line of a lead's score explanation. */
export interface ScoreItem {
  id: string; // signal id, or "coverage" / "price_estimate"
  label: string;
  points: number; // signed; 0 when status is "unknown" or "info"
  status?: "fired" | "unknown" | "info"; // unknown = not enough evidence to decide; info = coverage / calculation
  snippet: string; // verbatim evidence, or the calculation
  url: string;
  title?: string;
}

/** A producer an importer carries, as read on its website. */
export interface PortfolioItem {
  producer: string;
  country: string;
  region: string;
  appellation: string;
  grapes: string[];
  url: string; // page where the producer is listed
  quote: string; // verbatim text around the producer name on that page
}

export interface Message {
  id: string;
  leadId: string;
  channel: "email" | "linkedin";
  subject: string;
  body: string;
  variant: string; // A/B test label
  status: "pending" | "approved" | "rejected" | "sent";
  createdAt: string;
}

export type Actor = "agent" | "rep";

/** Audit log entry: every stage move and outbound action. */
export interface LeadEvent {
  id: string;
  leadId: string;
  type: "stage" | "enriched" | "drafted" | "approved" | "rejected" | "edited" | "sent";
  stage?: Stage;
  actor: Actor;
  at: string;
  note?: string;
}

/** "Agent Thinking" feed. */
export interface ThoughtLog {
  id: string;
  at: string;
  agent: "planner" | "discovery" | "graph" | "enrichment" | "writer" | "reviewer" | "billing";
  text: string;
}
