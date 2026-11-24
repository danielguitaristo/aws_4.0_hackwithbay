"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { METROS, normalizeMetro, type Metro } from "@/components/CaliforniaMap";
import { Back, Headline, Page, Row } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { FALLBACK_ICP } from "@/lib/demo";
import type { ICP } from "@/lib/types";

const TYPE: Record<string, string> = { importer_distributor: "an importer who also distributes", importer: "an importer", distributor: "a distributor" };

// Segments outside California can't be searched yet.
const OTHER_STATE = /new york|texas|illinois|florida|oregon|washington|belgium|denmark|europe|export/i;

type Field = { key: keyof ICP; label: string; show: (i: ICP) => string; parse: (v: string) => Partial<ICP> };
const list = (v: string) => v.split(/[·,]/).map((x) => x.trim()).filter(Boolean);
const FIELDS: Field[] = [
  { key: "buyerTypes", label: "Type", show: (i) => i.buyerTypes.map((t) => TYPE[t] ?? t).join(", or "), parse: () => ({}) },
  { key: "metros", label: "Where in California", show: (i) => i.metros.join(" · "), parse: () => ({}) },
  { key: "portfolioFit", label: "Already carries", show: (i) => i.portfolioFit.join(", "), parse: (v) => ({ portfolioFit: list(v) }) },
  { key: "sizeBand", label: "Size", show: (i) => i.sizeBand, parse: (v) => ({ sizeBand: v }) },
  { key: "priceBand", label: "US shelf price", show: (i) => i.priceBand, parse: (v) => ({ priceBand: v }) },
];

export default function Target() {
  const router = useRouter();
  const { icp: stored, updateIcp, onboarded } = useApp();
  const icp = stored ?? FALLBACK_ICP;
  const [editing, setEditing] = useState<keyof ICP | null>(null);
  const [draft, setDraft] = useState("");

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
              {f.key === "metros" ? (
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {METROS.map((m) => (
                    <button key={m} aria-pressed={zones.has(m)} onClick={() => toggleZone(m)} className={zones.has(m) ? "text-wine" : "text-taupe hover:text-ink"}>
                      {zones.has(m) ? "✓ " : ""}
                      {m}
                    </button>
                  ))}
                </div>
              ) : editing === f.key ? (
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(f)} onKeyDown={(e) => e.key === "Enter" && commit(f)} className="w-full border-b border-wine bg-transparent outline-none" />
              ) : (
                <button className="text-left first-letter:uppercase hover:text-wine" onClick={() => { setEditing(f.key); setDraft(f.show(icp)); }}>
                  {f.show(icp)}
                </button>
              )}
            </Row>
          </div>
        ))}
      </div>

      <Row label="Other states">
        <em className="text-taupe">New York, Texas, Illinois — coming next</em>
      </Row>

      <p className="caps mt-10 mb-1">Also worth trying</p>
      {icp.expansions.slice(0, 2).map((e, i) => (
        <div key={e.id} className={i === 1 ? "border-b border-rule" : ""}>
          <Row
            aside={
              OTHER_STATE.test(e.segment) ? (
                <em className="note text-sm">coming next</em>
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
