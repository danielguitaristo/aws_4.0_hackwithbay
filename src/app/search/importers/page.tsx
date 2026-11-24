"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CaliforniaMap } from "@/components/CaliforniaMap";
import { Headline, Page } from "@/components/ui";
import { COST, useApp } from "@/lib/app-state";
import { MOCK_LEADS } from "@/lib/demo";

const PROGRESS = [
  "Licensed importers in California",
  "Those that also distribute to shops and restaurants",
  "Reading their catalogs for Loire wines…",
  "Ranking the best fits",
];

function Searching() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, PROGRESS.length - 1)), 1500);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <Headline lead="Looking for" tail="your importers." />
      <div className="mt-8 grid grid-cols-[200px_1fr] gap-10">
        <CaliforniaMap leads={MOCK_LEADS.slice(0, step + 1).map((l) => ({ ...l, tier: "C" }))} pulse />
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
  const { leads, letters, searching, discover, findContact, draft, moveStage, credits, ready } = app;
  const started = useRef(false);
  const [selected, setSelected] = useState<string>();
  const [why, setWhy] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (ready && !leads.length && !searching && !started.current) {
      started.current = true;
      discover();
    }
  }, [ready, leads.length, searching, discover]);

  const ranked = useMemo(() => leads.filter((l) => l.stage !== "lost").sort((a, b) => b.fitScore - a.fitScore), [leads]);
  const sel = ranked.find((l) => l.id === selected) ?? ranked[0];
  const pending = letters.filter((l) => l.status === "pending").length;
  const drafted = (id: string) => letters.some((l) => l.leadId === id);
  const shown = all ? ranked : ranked.slice(0, 4);

  if (!ready) return null;
  if (searching || !ranked.length) return <Page step={2}><Searching /></Page>;

  const first = sel.contact?.name?.split(" ")[0];
  const hasEmail = !!sel.contact?.email;

  return (
    <Page step={2}>
      <Headline lead={`${ranked.length} importers`} tail="fit your estate." />
      <div className="mt-8 grid grid-cols-[200px_1fr] gap-10">
        <CaliforniaMap leads={ranked} selected={sel.id} onSelect={(id) => { setSelected(id); setWhy(false); }} />
        <div className="min-w-0">
          {shown.map((l) =>
            l.id === sel.id ? (
              <div key={l.id} className="border-t border-wine pt-3 pb-5">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="truncate font-serif text-2xl">{l.name}</span>
                  <span className="font-serif text-3xl text-wine">{l.fitScore}</span>
                </div>
                {l.signals[0] && <p className="mt-2 font-serif text-lg italic">{l.signals[0]}</p>}
                <p className="mt-2 text-xs text-taupe">
                  {l.city} · <button className="underline hover:text-ink" onClick={() => setWhy(!why)}>{why ? "hide details" : "why this match"}</button>
                </p>
                {why && (
                  <div className="mt-3 space-y-1 border-l border-rule pl-4 text-sm text-taupe">
                    {l.portfolio.length > 0 && <p>Already imports: {l.portfolio.join(", ")}</p>}
                    {l.permits.map((p) => <p key={p.number}>{p.source} {p.kind} permit ✓</p>)}
                    {l.signals.slice(1).map((s) => <p key={s}>{s}</p>)}
                    {l.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="block underline hover:text-ink">{s.title ?? new URL(s.url).hostname}</a>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex items-center gap-5">
                  {drafted(l.id) ? (
                    <Link href="/search/letters" className="caps text-wine underline">Letter ready · review</Link>
                  ) : hasEmail ? (
                    <button className="btn" onClick={() => draft(l.id)}>Write to {first ?? "them"}</button>
                  ) : (
                    <button className="btn" onClick={() => findContact(l.id)} disabled={credits < COST.contact}>
                      Find contact · {COST.contact} credits
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
                  {drafted(l.id) && <span className="caps">letter ready</span>}
                  <span className="font-serif text-xl">{l.fitScore}</span>
                </span>
              </button>
            ),
          )}
          <div className="flex justify-between border-t border-rule pt-3">
            {ranked.length > 4 && <button className="caps hover:text-ink" onClick={() => setAll(!all)}>{all ? "Show fewer" : `See all ${ranked.length}`}</button>}
            {pending > 0 && <Link href="/search/letters" className="caps ml-auto underline hover:text-ink">Review {pending} letter{pending > 1 ? "s" : ""} →</Link>}
          </div>
        </div>
      </div>
    </Page>
  );
}
