"use client";
// Client-side app state for the UI (owner: C). Calls the team's API routes when they
// exist and falls back to demo data, so every screen works on its own. Persisted in
// localStorage so a demo survives reloads.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEMO_DOMAINE, FALLBACK_ICP, MOCK_LEADS } from "./demo";
import type { Actor, Domaine, ICP, Lead, LeadEvent, Message, Stage } from "./types";

export type Letter = Message & { bodyFr?: string; kind?: "intro" | "follow_up" | "reply" };

export const COST = { contact: 5, send: 2 } as const;

interface State {
  domaine: Domaine;
  icp: ICP | null;
  leads: Lead[];
  letters: Letter[];
  events: LeadEvent[];
  credits: number;
  onboarded: boolean;
  replies: Record<string, string>; // leadId -> reply excerpt
  lastSearch: string; // last search step Claire was on, for "Resume"
}

const initial: State = {
  domaine: DEMO_DOMAINE,
  icp: null,
  leads: [],
  letters: [],
  events: [],
  credits: 150,
  onboarded: false,
  replies: {},
  lastSearch: "/search/target",
};

const KEY = "millesime-state-v1";
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

async function post<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function draftFor(lead: Lead, d: Domaine, variant: string): Pick<Letter, "subject" | "body" | "bodyFr"> {
  const first = lead.contact?.name?.split(" ")[0] ?? "there";
  const hook = lead.signals[0] ?? `I came across ${lead.name} while looking for importers who love small growers`;
  const signature = `Claire Martin\n${d.name}`;
  const estate = `We're a small organic estate in ${d.region.split("(")[1]?.replace(")", "") ?? d.region} making mineral ${d.grapes[0]}, still and sparkling, and we're looking for our first US partner.`;
  return {
    subject: `Organic ${d.appellations[1] ?? d.appellations[0]} for ${lead.name}?`,
    // A leads with the importer's signal, B leads with the estate's story — compared on the Results page.
    body: variant === "B" ? `Hi ${first},\n\n${estate} ${hook}.\n\nCould I send you two sample bottles?\n\n${signature}` : `Hi ${first},\n\n${hook}. ${estate}\n\nCould I send you two sample bottles?\n\n${signature}`,
    bodyFr: `Bonjour ${first},\n\n(${hook}.) Nous sommes un petit domaine bio qui produit du ${d.grapes[0]} minéral, tranquille et effervescent, et nous cherchons notre premier partenaire aux États-Unis.\n\nPuis-je vous envoyer deux bouteilles à déguster ?\n\n${signature}`,
  };
}

function useAppState() {
  const [s, setS] = useState<State>(initial);
  const [ready, setReady] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setS({ ...initial, ...JSON.parse(raw) });
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  }, [s, ready]);

  const log = (st: State, leadId: string, type: LeadEvent["type"], actor: Actor, extra: Partial<LeadEvent> = {}): LeadEvent[] => [
    ...st.events,
    { id: uid(), leadId, type, actor, at: now(), ...extra },
  ];

  const saveDomaine = useCallback((patch: Partial<Domaine>) => setS((st) => ({ ...st, domaine: { ...st.domaine, ...patch } })), []);

  const buildIcp = useCallback(async () => {
    const icp = (await post<ICP>("/api/icp", s.domaine)) ?? FALLBACK_ICP;
    setS((st) => ({ ...st, icp }));
    return icp;
  }, [s.domaine]);

  const updateIcp = useCallback((patch: Partial<ICP>) => setS((st) => ({ ...st, icp: { ...(st.icp ?? FALLBACK_ICP), ...patch } })), []);

  const discover = useCallback(async () => {
    setSearching(true);
    const started = Date.now();
    const found = await post<Lead[]>("/api/discover", s.icp ?? FALLBACK_ICP);
    const leads = found && found.length ? found : MOCK_LEADS;
    // keep the progress visible long enough to read in the demo
    await new Promise((r) => setTimeout(r, Math.max(0, 6000 - (Date.now() - started))));
    setS((st) => ({ ...st, leads: leads.map((l) => ({ ...l, stage: "matched" as Stage })) }));
    setSearching(false);
  }, [s.icp]);

  const findContact = useCallback((leadId: string) => {
    setS((st) => {
      if (st.credits < COST.contact) return st;
      const leads = st.leads.map((l) =>
        l.id === leadId
          ? { ...l, enriched: true, contact: l.contact ?? { name: "Owner", role: "Founder", email: `hello@${l.website?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ?? "example.com"}`, emailStatus: "valid" as const } }
          : l,
      );
      return { ...st, leads, credits: st.credits - COST.contact, events: log(st, leadId, "enriched", "agent") };
    });
  }, []);

  const draft = useCallback(async (leadId: string, kind: Letter["kind"] = "intro") => {
    const lead = s.leads.find((l) => l.id === leadId);
    if (!lead) return;
    const variant = s.letters.filter((l) => l.kind === "intro").length % 2 ? "B" : "A";
    const fromApi = await post<Message>(`/api/leads/${leadId}/draft`, { channel: "email", variant });
    const base = fromApi ?? { id: uid(), leadId, channel: "email" as const, variant, status: "pending" as const, createdAt: now(), ...draftFor(lead, s.domaine, variant) };
    const letter: Letter =
      kind === "follow_up"
        ? { ...base, kind, subject: `Re: ${base.subject}`, body: `Hi ${lead.contact?.name?.split(" ")[0] ?? "there"},\n\nJust following up on my note last week. Happy to send two bottles whenever suits you.\n\nClaire Martin\n${s.domaine.name}`, bodyFr: "Petite relance de mon message de la semaine dernière. Je peux vous envoyer deux bouteilles quand vous voulez." }
        : kind === "reply"
          ? { ...base, kind, subject: `Re: ${base.subject}`, body: `Hi ${lead.contact?.name?.split(" ")[0] ?? "there"},\n\nWonderful, thank you. I'll ship two bottles this week, one Vouvray sec and one pétillant. Could you share the address and the best name to put on the parcel?\n\nClaire Martin\n${s.domaine.name}`, bodyFr: "Merci beaucoup. J'envoie deux bouteilles cette semaine, un Vouvray sec et un pétillant. Pouvez-vous m'indiquer l'adresse et le nom à mettre sur le colis ?" }
          : { ...base, kind };
    setS((st) => ({ ...st, letters: [...st.letters.filter((x) => !(x.leadId === leadId && x.status === "pending")), letter], events: log(st, leadId, "drafted", "agent") }));
  }, [s.leads, s.domaine]);

  const editLetter = useCallback((id: string, patch: Partial<Letter>) => {
    setS((st) => ({ ...st, letters: st.letters.map((l) => (l.id === id ? { ...l, ...patch, bodyFr: patch.body ? undefined : l.bodyFr } : l)), events: log(st, st.letters.find((l) => l.id === id)!.leadId, "edited", "rep") }));
  }, []);

  const approve = useCallback((id: string) => {
    setS((st) => {
      const letter = st.letters.find((l) => l.id === id);
      if (!letter || st.credits < COST.send) return st;
      let events = log(st, letter.leadId, "approved", "rep");
      events = [...events, { id: uid(), leadId: letter.leadId, type: "sent", actor: "agent", at: now() }];
      const leads = st.leads.map((l) => (l.id === letter.leadId && l.stage === "matched" ? { ...l, stage: "contacted" as Stage } : l));
      return { ...st, leads, credits: st.credits - COST.send, events, letters: st.letters.map((l) => (l.id === id ? { ...l, status: "sent" } : l)) };
    });
  }, []);

  const skip = useCallback((id: string) => {
    setS((st) => ({ ...st, letters: st.letters.map((l) => (l.id === id ? { ...l, status: "rejected" } : l)), events: log(st, st.letters.find((l) => l.id === id)!.leadId, "rejected", "rep") }));
  }, []);

  const moveStage = useCallback((leadId: string, stage: Stage, actor: Actor = "rep") => {
    setS((st) => ({ ...st, leads: st.leads.map((l) => (l.id === leadId ? { ...l, stage } : l)), events: log(st, leadId, "stage", actor, { stage }) }));
  }, []);

  const addLead = useCallback((name: string, email: string, note: string) => {
    const id = uid();
    const lead: Lead = {
      id, name, type: "importer", state: "CA", city: "", permits: [], portfolio: [], fitScore: 0, tier: "B",
      contact: email ? { name: "", role: "", email } : undefined, signals: note ? [note] : [], sources: [], stage: "contacted", enriched: !!email,
    };
    setS((st) => ({ ...st, leads: [...st.leads, lead], events: log(st, id, "stage", "rep", { stage: "contacted", note: note || "Added by you" }) }));
  }, []);

  const finishOnboarding = useCallback(() => setS((st) => ({ ...st, onboarded: true })), []);
  const rememberSearch = useCallback((path: string) => setS((st) => (st.lastSearch === path ? st : { ...st, lastSearch: path })), []);
  const topUp = useCallback((n: number) => setS((st) => ({ ...st, credits: st.credits + n })), []);
  const reset = useCallback(() => setS(initial), []);

  /** Demo helper: jump "a week later" — first contacted lead replies, another needs a follow-up. */
  const weekLater = useCallback(() => {
    setS((st) => {
      const contacted = st.leads.filter((l) => l.stage === "contacted");
      if (!contacted.length) return st;
      const [first] = contacted;
      const old = new Date(Date.now() - 8 * 864e5).toISOString();
      const events = st.events.map((e) => (e.type === "sent" && e.leadId !== first.id ? { ...e, at: old } : e));
      return {
        ...st,
        leads: st.leads.map((l) => (l.id === first.id ? { ...l, stage: "replied" as Stage } : l)),
        replies: { ...st.replies, [first.id]: "Happy to taste — can you ship two bottles to our warehouse?" },
        events: [...events, { id: uid(), leadId: first.id, type: "stage", stage: "replied", actor: "agent", at: now(), note: "Reply detected in Gmail" }],
      };
    });
  }, []);

  return { ...s, ready, searching, saveDomaine, buildIcp, updateIcp, discover, findContact, draft, editLetter, approve, skip, moveStage, addLead, finishOnboarding, rememberSearch, topUp, reset, weekLater };
}

type App = ReturnType<typeof useAppState>;
const Ctx = createContext<App | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const app = useAppState();
  return <Ctx.Provider value={app}>{children}</Ctx.Provider>;
}

export function useApp() {
  const app = useContext(Ctx);
  if (!app) throw new Error("useApp must be used inside AppProvider");
  return app;
}

/** Last time a lead was touched, and by whom (for the AI / YOU markers). */
export function lastTouch(events: LeadEvent[], leadId: string) {
  const e = [...events].reverse().find((x) => x.leadId === leadId);
  if (!e) return null;
  const mins = Math.max(1, Math.round((Date.now() - new Date(e.at).getTime()) / 60000));
  const ago = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return { actor: e.actor === "agent" ? "AI" : "You", ago, days: mins / 1440, note: e.note };
}
