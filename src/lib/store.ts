import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Actor, Domaine, Lead, LeadEvent, Message, Stage, ThoughtLog } from "./types";
import { DEMO_DOMAINE, MOCK_LEADS, MOCK_MESSAGES } from "./demo";

export interface BillingLedgerEntry {
  id: string;
  event: string;
  quantity: number;
  creditsUsed: number;
  costUsd: number;
  flexpriceSynced: boolean;
  at: string;
  leadId?: string;
}

export interface RuntimeState {
  domaine: Domaine;
  leads: Lead[];
  messages: Message[];
  events: LeadEvent[];
  thoughts: ThoughtLog[];
  creditsRemaining: number;
  startingCredits: number;
  billingLedger: BillingLedgerEntry[];
  flexpriceCustomerId?: string;
  flexpriceWalletId?: string;
}

const STATE_FILE = path.join(process.cwd(), "data", "runtime", "state.json");

function makeInitialState(): RuntimeState {
  const startingCredits = Number(process.env.STARTING_CREDITS || "200");
  const safeCredits = Number.isFinite(startingCredits) && startingCredits > 0 ? startingCredits : 200;
  const now = new Date().toISOString();

  const initialEvents: LeadEvent[] = [
    {
      id: "evt_init_1",
      leadId: "mock1",
      type: "enriched",
      actor: "agent",
      at: now,
      note: "Resolved contact email for Example Selections",
    },
    {
      id: "evt_init_2",
      leadId: "mock1",
      type: "drafted",
      actor: "agent",
      at: now,
      note: "Drafted Variant A email awaiting human approval",
    },
    {
      id: "evt_init_3",
      leadId: "mock2",
      type: "stage",
      stage: "contacted",
      actor: "rep",
      at: now,
      note: "Moved to Contacted by sales rep",
    },
  ];

  const initialThoughts: ThoughtLog[] = [
    {
      id: "th_init_1",
      at: now,
      agent: "planner",
      text: "Initialized WineGTM workspace for Domaine des Petites Pierres (Loire Valley).",
    },
    {
      id: "th_init_2",
      at: now,
      agent: "graph",
      text: "Ready to map Company, Person, Product, Competitor, and Signal nodes in Neo4j.",
    },
  ];

  return {
    domaine: structuredClone(DEMO_DOMAINE),
    leads: structuredClone(MOCK_LEADS),
    messages: structuredClone(MOCK_MESSAGES),
    events: initialEvents,
    thoughts: initialThoughts,
    creditsRemaining: safeCredits,
    startingCredits: safeCredits,
    billingLedger: [],
  };
}

declare global {
  var __wineGtmState: RuntimeState | undefined;
}

function readStateFromDisk(): RuntimeState | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as RuntimeState;
    if (!parsed || !Array.isArray(parsed.leads) || !Array.isArray(parsed.messages)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: RuntimeState): void {
  globalThis.__wineGtmState = state;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    // Serverless environments may have read-only filesystems; keep in-memory state.
  }
}

export function getState(): RuntimeState {
  if (globalThis.__wineGtmState) {
    return globalThis.__wineGtmState;
  }
  const fromDisk = readStateFromDisk();
  if (fromDisk) {
    globalThis.__wineGtmState = fromDisk;
    return fromDisk;
  }
  const initial = makeInitialState();
  saveState(initial);
  return initial;
}

export function newId(prefix: string): string {
  const randomPart = crypto.randomBytes(4).toString("hex");
  return `${prefix}_${Date.now()}_${randomPart}`;
}

export function getDomaine(): Domaine {
  return getState().domaine;
}

export function setDomaine(domaine: Domaine): Domaine {
  const state = getState();
  state.domaine = domaine;
  saveState(state);
  return state.domaine;
}

export function listLeads(): Lead[] {
  return getState().leads;
}

export function getLead(id: string): Lead | undefined {
  const state = getState();
  return state.leads.find((lead) => lead.id === id);
}

export function upsertLeads(incoming: Lead[]): Lead[] {
  const state = getState();
  const updated: Lead[] = [];

  for (const item of incoming) {
    const existingIndex = state.leads.findIndex((lead) => lead.id === item.id);
    if (existingIndex >= 0) {
      state.leads[existingIndex] = item;
      updated.push(item);
    } else {
      state.leads.push(item);
      updated.push(item);
    }
  }

  saveState(state);
  return updated;
}

export function updateLead(id: string, patch: Partial<Lead>): Lead | null {
  const state = getState();
  const index = state.leads.findIndex((lead) => lead.id === id);
  if (index < 0) return null;

  const current = state.leads[index];
  const next: Lead = { ...current, ...patch, id: current.id };
  state.leads[index] = next;
  saveState(state);
  return next;
}

export function listMessages(leadId?: string): Message[] {
  const state = getState();
  if (!leadId) return state.messages;
  return state.messages.filter((msg) => msg.leadId === leadId);
}

export function getMessage(id: string): Message | undefined {
  const state = getState();
  return state.messages.find((msg) => msg.id === id);
}

export function addMessage(msg: Message): Message {
  const state = getState();
  state.messages.unshift(msg);
  saveState(state);
  return msg;
}

export function updateMessage(id: string, patch: Partial<Message>): Message | null {
  const state = getState();
  const index = state.messages.findIndex((msg) => msg.id === id);
  if (index < 0) return null;

  const current = state.messages[index];
  const next: Message = { ...current, ...patch, id: current.id };
  state.messages[index] = next;
  saveState(state);
  return next;
}

export function listEvents(leadId?: string): LeadEvent[] {
  const state = getState();
  if (!leadId) return state.events;
  return state.events.filter((evt) => evt.leadId === leadId);
}

export function addEvent(params: {
  leadId: string;
  type: LeadEvent["type"];
  actor: Actor;
  stage?: Stage;
  note?: string;
}): LeadEvent {
  const state = getState();
  const evt: LeadEvent = {
    id: newId("evt"),
    leadId: params.leadId,
    type: params.type,
    stage: params.stage,
    actor: params.actor,
    at: new Date().toISOString(),
    note: params.note,
  };
  state.events.unshift(evt);
  saveState(state);
  return evt;
}

export function listThoughts(limit = 50): ThoughtLog[] {
  const state = getState();
  return state.thoughts.slice(0, limit);
}

export function addThought(agent: ThoughtLog["agent"], text: string): ThoughtLog {
  const state = getState();
  const log: ThoughtLog = {
    id: newId("th"),
    at: new Date().toISOString(),
    agent,
    text,
  };
  state.thoughts.unshift(log);
  if (state.thoughts.length > 100) {
    state.thoughts = state.thoughts.slice(0, 100);
  }
  saveState(state);
  return log;
}
