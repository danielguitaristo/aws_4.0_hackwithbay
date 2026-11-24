"use client";
// Client-side app state for the UI (owner: C). Calls the team's API routes when they
// exist and falls back to demo data, so every screen works on its own. Persisted in
// localStorage so a demo survives reloads.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEMO_DOMAINE, FALLBACK_ICP, MOCK_LEADS } from "./demo";
import type { Actor, Domaine, ICP, Lead, LeadEvent, Message, Stage } from "./types";

export type Letter = Message & { bodyFr?: string; kind?: "intro" | "follow_up" | "reply"; to?: string; threadId?: string };

export const COST = { contact: 5, send: 2 } as const;
/** sendLetter() returns this when the balance can't cover the send. */
export const CREDITS = "__credits__";

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
  gmail: boolean; // Gmail connected for sending (asked at first send, not at sign-in)
  gmailEmail?: string;
  graph: Record<string, string>; // leadId -> multi-hop insight from B's knowledge graph
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
  gmail: false,
  graph: {},
};

const KEY = "millesime-state-v1";
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

async function post<T>(url: string, body: unknown): Promise<T | null> {
  return (await call<T>(url, "POST", body)).data;
}

/** fetch wrapper that never throws: { ok, status, data } (data is null on failure). */
async function call<T>(url: string, method = "GET", body?: unknown): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data: res.ok ? data : null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
const fire = (url: string, method: string, body: unknown) => void call(url, method, body);

/** The state being searched (California first). */
export const stateOf = (icp: ICP | null) => (icp?.states?.[0] ?? "CA").toUpperCase();

/** A contact's first name, or undefined when the "name" is really a role ("Portfolio Buyer", "Owner"). */
export function firstNameOf(lead: Lead): string | undefined {
  const name = lead.contact?.name ?? "";
  if (!name || /buyer|owner|team|portfolio|director|founder|info|contact|manager/i.test(name)) return undefined;
  return name.split(" ")[0];
}

/** The single best reason this importer fits: A's top positive score line, else a cleaned signal. */
export function reasonOf(lead: Lead): string | undefined {
  const best = (lead.scoreBreakdown ?? []).filter((s) => s.status !== "unknown" && s.points > 0).sort((a, b) => b.points - a.points)[0];
  return best?.label ?? lead.signals[0]?.replace(/^[+-]?\d+\s+/, "");
}

/** Fallback letter hook, phrased as a sentence. B's Mistral route writes the real letters. */
export function hookOf(lead: Lead): string {
  const r = reasonOf(lead);
  return r ? `I came across ${lead.name} and your ${r.charAt(0).toLowerCase()}${r.slice(1)}` : `I came across ${lead.name} while looking for importers who love small growers`;
}

function draftFor(lead: Lead, d: Domaine, variant: string): Pick<Letter, "subject" | "body" | "bodyFr"> {
  const first = firstNameOf(lead) ?? "there";
  const hook = hookOf(lead);
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
  // true when the server has Google OAuth keys: Gmail is real; otherwise it is simulated
  const [gmailReal, setGmailReal] = useState(false);

  useEffect(() => {
    try {
      // any URL with ?reset starts a clean session (demo recordings, teammates' tests)
      if (new URLSearchParams(window.location.search).has("reset")) {
        localStorage.removeItem(KEY);
        sessionStorage.clear();
        window.history.replaceState(null, "", window.location.pathname);
      } else {
        const raw = localStorage.getItem(KEY);
        if (raw) setS({ ...initial, ...JSON.parse(raw) });
      }
    } catch {}
    setReady(true);
    fetch("/api/gmail/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((st: { configured: boolean; connected: boolean; email?: string } | null) => {
        if (!st?.configured) return;
        setGmailReal(true);
        setS((x) => ({ ...x, gmail: st.connected, gmailEmail: st.email }));
      })
      .catch(() => {});
    syncCredits();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Credits come from B's billing (Flexprice) when it answers; the local counter is the fallback. */
  const syncCredits = useCallback(async () => {
    const r = await call<{ creditsRemaining: number }>("/api/billing");
    if (r.data && typeof r.data.creditsRemaining === "number") setS((x) => ({ ...x, credits: r.data!.creditsRemaining }));
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
    const icp = s.icp ?? FALLBACK_ICP;
    const state = stateOf(icp);
    const found = await post<Lead[]>("/api/discover", icp);
    const leads = found && found.length ? found : state === "CA" ? MOCK_LEADS : [];
    // keep the progress visible long enough to read in the demo
    await new Promise((r) => setTimeout(r, Math.max(0, 6000 - (Date.now() - started))));
    const matched = leads.map((l) => ({ ...l, state: l.state || state, stage: "matched" as Stage }));
    // Add this state's importers without wiping other states; relationships already in progress keep their stage.
    setS((st) => {
      const old = new Map(st.leads.map((l) => [l.id, l]));
      const merged = matched.map((m) => (old.get(m.id) && old.get(m.id)!.stage !== "matched" ? old.get(m.id)! : m));
      const ids = new Set(merged.map((m) => m.id));
      return { ...st, leads: [...st.leads.filter((l) => !ids.has(l.id)), ...merged] };
    });
    setSearching(false);
    // Hand the leads to B (store + knowledge graph), then keep the graph's multi-hop insights.
    await call("/api/leads", "POST", { action: "ingest", leads: matched, domaine: s.domaine });
    const g = await call<{ appellationGaps?: { leadId: string; reason: string }[] }>("/api/graph?charge=false");
    if (g.data?.appellationGaps?.length) setS((st) => ({ ...st, graph: { ...st.graph, ...Object.fromEntries(g.data!.appellationGaps!.map((x) => [x.leadId, x.reason])) } }));
  }, [s.icp, s.domaine]);

  /** B's Hunter enrichment (metered by Flexprice). Returns "credits" when the balance is too low. */
  const findContact = useCallback(async (leadId: string): Promise<"ok" | "credits"> => {
    const r = await call<{ lead: Lead }>("/api/leads", "POST", { action: "enrich", leadId });
    if (r.status === 402) return "credits";
    if (r.data?.lead?.contact?.email) {
      const enriched = r.data.lead;
      setS((st) => ({ ...st, leads: st.leads.map((l) => (l.id === leadId ? { ...l, enriched: true, contact: enriched.contact } : l)), events: log(st, leadId, "enriched", "agent") }));
      syncCredits();
      return "ok";
    }
    if (s.credits < COST.contact) return "credits";
    setS((st) => {
      if (st.credits < COST.contact) return st;
      // Fallback when B's enrichment finds nothing: keep a known name, fill a likely email.
      const leads = st.leads.map((l) => {
        if (l.id !== leadId) return l;
        const domain = l.website?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ?? `${l.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`;
        const name = l.contact?.name ?? "Owner";
        const email = l.contact?.email ?? `${name.split(" ")[0].toLowerCase()}@${domain}`;
        return { ...l, enriched: true, contact: { role: "Founder", ...l.contact, name, email, emailStatus: "valid" as const } };
      });
      return { ...st, leads, credits: st.credits - COST.contact, events: log(st, leadId, "enriched", "agent") };
    });
    return "ok";
  }, [s.credits, syncCredits]);

  const draft = useCallback(async (leadId: string, kind: Letter["kind"] = "intro") => {
    const lead = s.leads.find((l) => l.id === leadId);
    if (!lead) return;
    const variant = s.letters.filter((l) => l.kind === "intro").length % 2 ? "B" : "A";
    // B's Mistral draft (intro letters only); local template as fallback.
    const fromApi = kind === "intro" ? (await post<{ message: Message }>("/api/messages", { action: "draft", leadId, channel: "email", variant, graphReason: s.graph[leadId] }))?.message : null;
    const base = fromApi ??{ id: uid(), leadId, channel: "email" as const, variant, status: "pending" as const, createdAt: now(), ...draftFor(lead, s.domaine, variant) };
    const letter: Letter =
      kind === "follow_up"
        ? { ...base, kind, subject: `Re: ${base.subject}`, body: `Hi ${firstNameOf(lead) ?? "there"},\n\nJust following up on my note last week. Happy to send two bottles whenever suits you.\n\nClaire Martin\n${s.domaine.name}`, bodyFr: "Petite relance de mon message de la semaine dernière. Je peux vous envoyer deux bouteilles quand vous voulez." }
        : kind === "reply"
          ? { ...base, kind, subject: `Re: ${base.subject}`, body: `Hi ${firstNameOf(lead) ?? "there"},\n\nWonderful, thank you. I'll ship two bottles this week, one Vouvray sec and one pétillant. Could you share the address and the best name to put on the parcel?\n\nClaire Martin\n${s.domaine.name}`, bodyFr: "Merci beaucoup. J'envoie deux bouteilles cette semaine, un Vouvray sec et un pétillant. Pouvez-vous m'indiquer l'adresse et le nom à mettre sur le colis ?" }
          : { ...base, kind };
    setS((st) => ({ ...st, letters: [...st.letters.filter((x) => !(x.leadId === leadId && x.status === "pending")), letter], events: log(st, leadId, "drafted", "agent") }));
  }, [s.leads, s.domaine, s.letters, s.graph]);

  const editLetter = useCallback((id: string, patch: Partial<Letter>) => {
    fire("/api/messages", "POST", { action: "edit", messageId: id, subject: patch.subject, body: patch.body });
    setS((st) => ({ ...st, letters: st.letters.map((l) => (l.id === id ? { ...l, ...patch, bodyFr: patch.body ? undefined : l.bodyFr } : l)), events: log(st, st.letters.find((l) => l.id === id)!.leadId, "edited", "rep") }));
  }, []);

  const approve = useCallback((id: string, sent?: { threadId: string; to: string }) => {
    setS((st) => {
      const letter = st.letters.find((l) => l.id === id);
      if (!letter || st.credits < COST.send) return st;
      let events = log(st, letter.leadId, "approved", "rep");
      events = [...events, { id: uid(), leadId: letter.leadId, type: "sent", actor: "agent", at: now(), note: sent ? `Sent from Gmail to ${sent.to}` : undefined }];
      const leads = st.leads.map((l) => (l.id === letter.leadId && l.stage === "matched" ? { ...l, stage: "contacted" as Stage } : l));
      return { ...st, leads, credits: st.credits - COST.send, events, letters: st.letters.map((l) => (l.id === id ? { ...l, status: "sent", ...sent } : l)) };
    });
  }, []);

  /** Sends through Gmail when it is really connected, then marks the letter sent. Returns an error message or null. */
  const sendLetter = useCallback(
    async (id: string): Promise<string | null> => {
      const letter = s.letters.find((l) => l.id === id);
      const lead = letter && s.leads.find((l) => l.id === letter.leadId);
      if (!letter || !lead) return "Letter not found";
      // B's HITL gate: record the human approval, then the send (metered by Flexprice).
      // 404 means the letter only exists locally (fallback draft) — carry on.
      await call("/api/messages", "POST", { action: "approve", messageId: id, subject: letter.subject, body: letter.body });
      const b = await call("/api/messages", "POST", { action: "send", messageId: id });
      if (b.status === 402) return CREDITS;
      if (!gmailReal) {
        approve(id);
        syncCredits();
        return null;
      }
      const to = letter.to ?? lead.contact?.email;
      if (!to) return "Add the importer's email first (Edit).";
      // follow-ups and replies stay in the same Gmail thread as the first letter
      const threadId = s.letters.find((l) => l.leadId === lead.id && l.threadId)?.threadId;
      try {
        const res = await fetch("/api/gmail/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, subject: letter.subject, body: letter.body, threadId }) });
        const data = await res.json();
        if (!res.ok) return data.error ?? "Gmail refused the letter.";
        approve(id, { threadId: data.threadId, to: data.to });
        syncCredits();
        return null;
      } catch {
        return "Couldn't reach Gmail. Try again.";
      }
    },
    [s.letters, s.leads, gmailReal, approve, syncCredits],
  );

  /** Looks for replies in the Gmail threads of sent letters and moves those leads to "replied". */
  const checkReplies = useCallback(async () => {
    const threads = s.letters.filter((l) => l.status === "sent" && l.threadId).map((l) => ({ leadId: l.leadId, threadId: l.threadId! }));
    if (!gmailReal || !s.gmail || !threads.length) return;
    try {
      const res = await fetch("/api/gmail/replies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threads }) });
      if (!res.ok) return;
      const found = (await res.json()) as { leadId: string; snippet: string }[];
      setS((st) => {
        const fresh = found.filter((f) => st.leads.find((l) => l.id === f.leadId)?.stage === "contacted");
        if (!fresh.length) return st;
        return {
          ...st,
          leads: st.leads.map((l) => (fresh.some((f) => f.leadId === l.id) ? { ...l, stage: "replied" as Stage } : l)),
          replies: { ...st.replies, ...Object.fromEntries(fresh.map((f) => [f.leadId, f.snippet])) },
          events: [...st.events, ...fresh.map((f) => ({ id: uid(), leadId: f.leadId, type: "stage" as const, stage: "replied" as Stage, actor: "agent" as Actor, at: now(), note: "Reply detected in Gmail" }))],
        };
      });
    } catch {}
  }, [s.letters, s.gmail, gmailReal]);

  const skip = useCallback((id: string) => {
    fire("/api/messages", "POST", { action: "reject", messageId: id });
    setS((st) => ({ ...st, letters: st.letters.map((l) => (l.id === id ? { ...l, status: "rejected" } : l)), events: log(st, st.letters.find((l) => l.id === id)!.leadId, "rejected", "rep") }));
  }, []);

  const moveStage = useCallback((leadId: string, stage: Stage, actor: Actor = "rep") => {
    fire("/api/leads", "PATCH", { leadId, stage, actor });
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
  /** Top-up through B's billing (Flexprice wallet); the local counter moves at once so the UI never waits. */
  const topUp = useCallback(async (n: number) => {
    setS((st) => ({ ...st, credits: st.credits + n }));
    await call("/api/billing", "POST", { action: "topup", amount: n });
    await syncCredits();
  }, [syncCredits]);
  /** Real Google consent when keys are set (the page leaves, returns with ?gmail=connected), simulated otherwise.
   *  Resolves true when connected right away, false when redirecting to Google. */
  const connectGmail = useCallback(async () => {
    if (gmailReal) {
      window.location.href = `/api/gmail/auth?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return false;
    }
    await new Promise((r) => setTimeout(r, 900));
    setS((st) => ({ ...st, gmail: true, gmailEmail: "claire@petitespierres.fr" }));
    return true;
  }, [gmailReal]);
  const disconnectGmail = useCallback(() => {
    if (gmailReal) fetch("/api/gmail/disconnect", { method: "POST" }).catch(() => {});
    setS((st) => ({ ...st, gmail: false, gmailEmail: undefined }));
  }, [gmailReal]);
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

  return { ...s, ready, searching, gmailReal, saveDomaine, buildIcp, updateIcp, discover, findContact, draft, editLetter, approve, sendLetter, checkReplies, skip, moveStage, addLead, finishOnboarding, rememberSearch, topUp, connectGmail, disconnectGmail, reset, weekLater };
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
