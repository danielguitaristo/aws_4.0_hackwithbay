"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { STATE_NAMES, StateMap } from "@/components/UsMap";
import { metroOf, normalizeMetro } from "@/lib/places";
import { FALLBACK_ICP } from "@/lib/demo";
import { Back, Headline, Page, TopUpDialog } from "@/components/ui";
import { COST, firstNameOf, reasonOf, stateOf, useApp } from "@/lib/app-state";
import { MOCK_LEADS } from "@/lib/demo";

const progress = (name: string) => [
  `Licensed importers in ${name}`,
  "Those that also distribute to shops and restaurants",
  "Reading their catalogs for Loire wines…",
  "Ranking the best fits",
];

function Searching({ state }: { state: string }) {
  const PROGRESS = progress(STATE_NAMES[state]);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, PROGRESS.length - 1)), 1500);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <Headline lead="Looking for" tail="your importers." />
      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-[200px_1fr] md:gap-10">
        <div className="max-w-40 md:max-w-none">
          <StateMap state={state} leads={state === "CA" ? MOCK_LEADS.slice(0, step + 1).map((l) => ({ ...l, tier: "C" as const })) : []} pulse />
        </div>
        <div>
          {PROGRESS.map((p, i) => (
            <div key={p} className={`grid grid-cols-[24px_1fr] border-t py-3 font-serif text-lg ${i === step ? "border-wine text-wine" : i < step ? "border-rule text-taupe" : "border-rule text-faint"} ${i === PROGRESS.length - 1 ? "border-b border-b-rule" : ""}`}>
              <span>{i < step ? "✓" : i === step ? "·" : ""}</span>
              <span className={i === step ? "italic" : ""}>{p}</span>
            </div>
          ))}
          <p className="note mt-5">About two minutes. You can leave — we&apos;ll email you when they&apos;re ready.</p>
        </div>
      </div>
    </>
  );
}

export default function Importers() {
  const app = useApp();
  const { leads, letters, searching, discover, findContact, draft, moveStage, credits, ready, graph, icp } = app;
  const [everywhere, setEverywhere] = useState(false);
  const [finding, setFinding] = useState(false);
  const find = async (id: string) => {
    if (credits < COST.contact) return setTopUp(true);
    setFinding(true);
    if ((await findContact(id)) === "credits") setTopUp(true);
    setFinding(false);
  };
  const started = useRef<string | null>(null);
  const [selected, setSelected] = useState<string>();
  const [why, setWhy] = useState(false);
  const [all, setAll] = useState(false);
  const [topUp, setTopUp] = useState(false);

  const state = stateOf(icp);
  const allRanked = useMemo(() => leads.filter((l) => (l.state || "CA") === state && l.stage !== "lost").sort((a, b) => b.fitScore - a.fitScore), [leads, state]);
  useEffect(() => {
    if (ready && !allRanked.length && !searching && started.current !== state) {
      started.current = state;
      discover();
    }
  }, [ready, allRanked.length, searching, discover, state]);

  // Only the zones Claire picked on the Target step (California first).
  const zones = useMemo(() => new Set(state === "CA" ? (icp ?? FALLBACK_ICP).metros.map(normalizeMetro).filter(Boolean) : []), [icp, state]);
  // Keep importers we can't place (unknown city) rather than hide them.
  const inZones = useMemo(() => allRanked.filter((l) => { const m = metroOf(l.city); return !m || zones.has(m); }), [allRanked, zones]);
  // No dead end: if the chosen zones are empty, show the rest of California and say so.
  const emptyZones = zones.size > 0 && inZones.length === 0;
  const ranked = everywhere || !zones.size || emptyZones ? allRanked : inZones;
  const elsewhere = allRanked.length - ranked.length;
  const sel = ranked.find((l) => l.id === selected) ?? ranked[0];
  const pending = letters.filter((l) => l.status === "pending").length;
  const drafted = (id: string) => letters.some((l) => l.leadId === id && l.status === "pending");
  const sentTo = (id: string) => letters.some((l) => l.leadId === id && l.status === "sent");
  const shown = all ? ranked : ranked.slice(0, 4);

  if (!ready) return null;
  if (searching || (!allRanked.length && started.current !== state)) return <Page step={2}><Searching state={state} /></Page>;
  if (!allRanked.length)
    return (
      <Page step={2}>
        <Headline lead={`No importers found in ${STATE_NAMES[state]}`} tail="yet." />
        <div className="mt-8"><Back href="/search/target" label="Choose another state" /></div>
      </Page>
    );
  // Leads from the federal permit list only: real licences, catalogs not read yet.
  const permitsOnly = allRanked.every((l) => (l.scoreBreakdown ?? []).every((b) => b.id.startsWith("permit_")) && !l.portfolio.length);

  const good = ranked.filter((l) => l.tier !== "C").length;
  const first = firstNameOf(sel); // undefined when the contact is a role, not a person
  const hasEmail = !!sel.contact?.email;

  return (
    <Page step={2}>
      {permitsOnly ? (
        <Headline lead={`${ranked.length} licensed importers,`} tail="a first look." />
      ) : (
        <Headline lead={`${ranked.length} importers,`} tail={good === 0 ? "none an obvious fit yet." : `${good === 1 ? "one" : good} worth a letter.`} />
      )}
      {permitsOnly && <p className="note mt-3 text-lg">Licensed importers from the federal registry. Their catalogs haven&apos;t been read yet, so the fit is a first estimate.</p>}
      {emptyZones && <p className="note mt-3 text-lg">None in your zones yet, so here is the rest of California. <Link href="/search/target" className="caps not-italic underline">Change zones</Link></p>}
      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-[200px_1fr] md:gap-10">
        <div className="max-w-48 md:max-w-none">
          <StateMap state={state} leads={ranked} selected={sel.id} onSelect={(id) => { setSelected(id); setWhy(false); }} />
        </div>
        <div className="min-w-0">
          {shown.map((l) =>
            l.id === sel.id ? (
              <div key={l.id} className="border-t border-wine pt-3 pb-5">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="truncate font-serif text-2xl">{l.name}</span>
                  <span className="font-serif text-3xl text-wine">{l.fitScore}</span>
                </div>
                {reasonOf(l) && <p className="mt-2 font-serif text-lg italic">{reasonOf(l)}</p>}
                <p className="mt-2 text-xs text-taupe">
                  {l.city} · <button className="underline hover:text-ink" onClick={() => setWhy(!why)}>{why ? "hide details" : "why this match"}</button>
                </p>
                {why && (
                  <div className="mt-3 space-y-3 border-l border-rule pl-4 text-sm text-taupe">
                    {graph[l.id] && <p className="text-ink"><span className="caps">Graph ·</span> {graph[l.id]}</p>}
                    {l.scoreBreakdown?.length ? (
                      l.scoreBreakdown
                        .filter((s) => s.status === "fired")
                        .map((s) => (
                          <div key={s.id}>
                            <p className="text-ink">
                              <span className="font-serif tabular-nums">{s.points > 0 ? `+${s.points}` : s.points}</span> {s.label}
                            </p>
                            <p className="note text-sm">
                              &ldquo;{s.snippet}&rdquo;{" "}
                              <a href={s.url} target="_blank" rel="noreferrer" className="not-italic underline hover:text-ink">{s.title ? s.title.slice(0, 40) : new URL(s.url).hostname}</a>
                            </p>
                          </div>
                        ))
                    ) : (
                      l.signals.map((s) => <p key={s}>{s}</p>)
                    )}
                    {l.permits.length > 0 && <p>{l.permits.map((p) => `${p.source} ${p.kind} permit ✓`).join(" · ")}</p>}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-5">
                  {sentTo(l.id) ? (
                    <span className="caps">Letter sent ✓</span>
                  ) : drafted(l.id) ? (
                    <Link href="/search/letters" className="caps text-wine underline">Letter ready · review</Link>
                  ) : hasEmail ? (
                    <button className="btn" onClick={() => draft(l.id)}>{first ? `Write to ${first}` : "Write a letter"}</button>
                  ) : (
                    <button className="btn" disabled={finding} onClick={() => find(l.id)}>
                      {finding ? "Finding the right person…" : `Find contact · ${COST.contact} credits`}
                    </button>
                  )}
                  <button className="text-xs text-taupe hover:text-ink" onClick={() => moveStage(l.id, "lost")}>Not for me</button>
                </div>
              </div>
            ) : (
              <button key={l.id} onClick={() => { setSelected(l.id); setWhy(false); }} className="flex w-full items-baseline justify-between gap-4 border-t border-rule py-3 text-left hover:text-wine">
                <span className="truncate font-serif text-xl">
                  {l.name} <span className="font-sans text-xs text-taupe">{l.city}</span>
                </span>
                <span className="flex items-baseline gap-3">
                  {sentTo(l.id) ? <span className="caps">sent</span> : drafted(l.id) && <span className="caps">letter ready</span>}
                  <span className="font-serif text-xl">{l.fitScore}</span>
                </span>
              </button>
            ),
          )}
          <div className="flex justify-between border-t border-rule pt-3">
            {ranked.length > 4 && <button className="caps hover:text-ink" onClick={() => setAll(!all)}>{all ? "Show fewer" : `See all ${ranked.length}`}</button>}
            {(elsewhere > 0 || everywhere) && (
              <button className="caps ml-auto underline hover:text-ink" onClick={() => setEverywhere(!everywhere)}>
                {everywhere ? "Only my zones" : `${elsewhere} more elsewhere in ${STATE_NAMES[state]}`}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-10 flex items-center justify-between gap-4">
        <Back href="/search/target" label="Target" />
        {pending > 0 && <Link href="/search/letters" className="caps text-wine underline">Review {pending} letter{pending > 1 ? "s" : ""} ›</Link>}
      </div>
      {topUp && (
        <TopUpDialog need={COST.contact} action="Finding a contact" onClose={() => setTopUp(false)} onDone={() => { setTopUp(false); find(sel.id); }} />
      )}
    </Page>
  );
}
