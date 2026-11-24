"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { STATE_NAMES, UsMap } from "@/components/UsMap";
import { METROS, metroOf, normalizeMetro, stateInText, SUPPORTED_STATES, type Metro } from "@/lib/places";
import { Back, Headline, Page, Row } from "@/components/ui";
import { stateOf, useApp } from "@/lib/app-state";
import { FALLBACK_ICP } from "@/lib/demo";
import type { ICP } from "@/lib/types";

const TYPE: Record<string, string> = { importer_distributor: "an importer who also distributes", importer: "an importer", distributor: "a distributor" };

type Field = { key: keyof ICP; label: string; show: (i: ICP) => string; parse: (v: string) => Partial<ICP> };
const list = (v: string) => v.split(/[·,]/).map((x) => x.trim()).filter(Boolean);
const FIELDS: Field[] = [
  { key: "buyerTypes", label: "Type", show: (i) => i.buyerTypes.map((t) => TYPE[t] ?? t).join(", or "), parse: () => ({}) },
  { key: "portfolioFit", label: "Already carries", show: (i) => i.portfolioFit.join(", "), parse: (v) => ({ portfolioFit: list(v) }) },
  { key: "sizeBand", label: "Size", show: (i) => i.sizeBand, parse: (v) => ({ sizeBand: v }) },
  { key: "priceBand", label: "US shelf price", show: (i) => i.priceBand, parse: (v) => ({ priceBand: v }) },
];

export default function Target() {
  const router = useRouter();
  const { icp: stored, updateIcp, onboarded, leads } = useApp();
  const icp = stored ?? FALLBACK_ICP;
  const [editing, setEditing] = useState<keyof ICP | null>(null);
  const [draft, setDraft] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch("/api/states").then((r) => r.json()).then((d) => setCounts(d.counts ?? {})).catch(() => {});
  }, []);
  const state = stateOf(icp);
  // Changing state starts a search there; California keeps its zones.
  const pickState = (code: string) =>
    updateIcp({ states: [code], metros: code === "CA" ? (icp.metros.some(normalizeMetro) ? icp.metros : ["San Francisco Bay Area", "Los Angeles"]) : [] });

  const commit = (f: Field) => {
    updateIcp({ ...f.parse(draft), confidence: { ...icp.confidence, [f.key]: 1 } });
    setEditing(null);
  };
  // California first: Claire picks zones inside the state; other states come next.
  const zones = new Set(icp.metros.map(normalizeMetro).filter(Boolean) as Metro[]);
  const toggleZone = (m: Metro) => {
    const next = new Set(zones);
    if (next.has(m)) next.delete(m);
    else next.add(m);
    if (next.size) updateIcp({ metros: METROS.filter((x) => next.has(x)), confidence: { ...icp.confidence, metros: 1 } });
  };
  const toggle = (id: string) =>
    updateIcp({ expansions: icp.expansions.map((e) => (e.id === id ? { ...e, status: e.status === "accepted" ? "suggested" : "accepted" } : e)) });

  return (
    <Page step={1}>
      <Headline lead="Who should" tail="carry your wine." />
      <div className="mt-8">
        {FIELDS.map((f, i) => (
          <div key={f.key} className={i === FIELDS.length - 1 ? "border-b border-rule" : ""}>
            <Row label={f.label} first={i === 0} aside={(icp.confidence[f.key] ?? 1) < 0.75 && <em className="note text-sm">our guess</em>}>
              {editing === f.key ? (
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(f)} onKeyDown={(e) => e.key === "Enter" && commit(f)} className="w-full border-b border-wine bg-transparent outline-none" />
              ) : (
                <button className="text-left first-letter:uppercase hover:text-wine" onClick={() => { setEditing(f.key); setDraft(f.show(icp)); }}>
                  {f.show(icp)}
                </button>
              )}
            </Row>
            {i === 0 && (
              <>
                <Row label="State" aside={<span className="caps">{(counts[state] ?? 0).toLocaleString("en-US")} licensed</span>}>
                  <p>
                    {STATE_NAMES[state]} <em className="note text-sm">· click a shaded state to search there</em>
                  </p>
                  <div className="mt-2 max-w-md">
                    <UsMap counts={counts} supported={SUPPORTED_STATES} selected={state} onSelect={pickState} />
                  </div>
                </Row>
                {state === "CA" && (
                  <Row label="Where in California">
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      {METROS.map((m) => (
                        <button key={m} aria-pressed={zones.has(m)} onClick={() => toggleZone(m)} className={zones.has(m) ? "text-wine" : "text-taupe hover:text-ink"}>
                          {zones.has(m) ? "✓ " : ""}
                          {m}
                          {leads.some((l) => l.state === "CA") && <span className="font-sans text-xs text-taupe"> · {leads.filter((l) => l.state === "CA" && metroOf(l.city) === m).length}</span>}
                        </button>
                      ))}
                    </div>
                  </Row>
                )}
              </>
            )}
          </div>
        ))}
      </div>


      <p className="caps mt-10 mb-1">Also worth trying</p>
      {icp.expansions.slice(0, 2).map((e, i) => (
        <div key={e.id} className={i === 1 ? "border-b border-rule" : ""}>
          <Row
            aside={
              stateInText(e.segment) && stateInText(e.segment) !== state ? (
                <button className="caps underline hover:text-ink" onClick={() => pickState(stateInText(e.segment)!)}>Search {STATE_NAMES[stateInText(e.segment)!]}</button>
              ) : (
                <button className="caps underline hover:text-ink" onClick={() => toggle(e.id)}>{e.status === "accepted" ? "Added" : "Add"}</button>
              )
            }
          >
            <span title={e.rationale}>{e.segment}</span>
          </Row>
        </div>
      ))}

      <div className="mt-8 flex items-center justify-between gap-4">
        <Back href={onboarded ? "/home" : "/estate"} label={onboarded ? "Home" : "Your estate"} />
        <button className="btn" onClick={() => router.push("/search/importers")}>Find importers</button>
      </div>
    </Page>
  );
}
