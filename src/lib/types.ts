// Shared contracts. Agree on these first; change them only as a team.

export type Confidence = Record<string, number>; // field name -> 0.00..1.00

/** The winemaker's own product, captured at intake. */
export interface Domaine {
  name: string;
  region: string;
  appellations: string[];
  grapes: string[];
  certifications: string[]; // "AB", "Demeter", "nature", ...
  priceRangeEur: { min: number; max: number }; // ex-cellar price per bottle
  annualBottles: number;
  currentClients: string[]; // reference wins
  description: string;
}

export type BuyerType = "caviste" | "restaurant" | "bar_a_vin" | "importer" | "epicerie_fine" | "hotel";

/** Ideal Customer Profile inferred from the Domaine. */
export interface ICP {
  buyerTypes: BuyerType[];
  nafCodes: string[]; // French NAF codes, e.g. 47.25Z (cavistes), 56.10A (restaurants)
  cities: string[];
  departements: string[]; // e.g. "75", "69"
  sizeBand: string; // e.g. "1-10 employees, independent"
  personas: string[]; // e.g. "Gérant / propriétaire", "Chef sommelier"
  priceBand: string;
  triggers: string[]; // buying signals to look for
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

export interface Contact {
  name: string;
  role: string;
  email?: string;
  emailStatus?: "valid" | "accept_all" | "unknown" | "invalid";
  linkedin?: string;
}

export type Stage = "matched" | "contacted" | "replied" | "meeting" | "won" | "lost";
export const STAGES: Stage[] = ["matched", "contacted", "replied", "meeting", "won", "lost"];
export const STAGE_LABELS: Record<Stage, string> = {
  matched: "Matched",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Tasting booked",
  won: "Listed (won)",
  lost: "Lost",
};

export interface Lead {
  id: string;
  name: string;
  type: BuyerType;
  city: string;
  address?: string;
  siren?: string;
  website?: string;
  contact?: Contact;
  fitScore: number; // 0..100
  tier: "A" | "B" | "C";
  signals: string[];
  sources: Source[];
  stage: Stage;
  enriched: boolean;
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
