"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { STATE_NAMES, UsMap } from "@/components/UsMap";
import { METROS, metroOf, normalizeMetro, stateInText, SUPPORTED_STATES } from "@/lib/places";
import { Back, Chips, Headline, Page, Row } from "@/components/ui";
import { stateOf, useApp } from "@/lib/app-state";
import { FALLBACK_ICP } from "@/lib/demo";
import type { BuyerType, ICP } from "@/lib/types";

// Pre-filled answers (the AI's guess is selected; Claire confirms or adjusts).
const TYPES: [BuyerType, string][] = [["importer_distributor", "Importer who also distributes"], ["importer", "Importer only"], ["distributor", "Distributor only"]];
const CARRIES = ["French natural wine", "Loire growers", "Small family estates", "Organic & biodynamic", "Burgundy & Beaujolais", "Champagne & sparkling"];
const SIZES = ["Boutique · 10–60 producers", "Mid-size · 60–200 producers", "Large · 200+ producers"];
const PRICES = ["$15 – 25", "$25 – 45", "$45 – 80", "$80+"];

export default function Target() {
  const router = useRouter();
  const { icp: stored, updateIcp, onboarded, leads } = useApp();
  const icp = stored ?? FALLBACK_ICP;
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch("/api/states").then((r) => r.json()).then((d) => setCounts(d.counts ?? {})).catch(() => {});
  }, []);
  const state = stateOf(icp);

  /** Saves a field and marks it as confirmed by Claire (no more "our guess"). */
  const set = (patch: Partial<ICP>, key: keyof ICP) => updateIcp({ ...patch, confidence: { ...icp.confidence, [key]: 1 } });
  const guess = (key: keyof ICP) => (icp.confidence[key] ?? 1) < 0.75 && <em className="note text-sm">our guess</em>;
  // Changing state starts a search there; California keeps its zones.
  const pickState = (code: string) =>
    updateIcp({ states: [code], metros: code === "CA" ? (icp.metros.some(normalizeMetro) ? icp.metros : ["San Francisco Bay Area", "Los Angeles"]) : [] });
  const zones = icp.metros.map(normalizeMetro).filter((m): m is (typeof METROS)[number] => Boolean(m));
  const zoneCounts = Object.fromEntries(METROS.map((m) => [m, leads.filter((l) => l.state === "CA" && metroOf(l.city) === m).length]));
  const toggle = (id: string) =>
    updateIcp({ expansions: icp.expansions.map((e) => (e.id === id ? { ...e, status: e.status === "accepted" ? "suggested" : "accepted" } : e)) });

  return (
    <Page step={1}>
      <Headline lead="Who should" tail="carry your wine." />
      <p className="note mt-3 text-lg">Our best guess for {icp.buyerTypes.length ? "your estate" : "you"}. Tap to adjust.</p>
      <div className="mt-8 border-b border-rule">
        <Row label="Type" first aside={guess("buyerTypes")}>
          <Chips
            options={TYPES.map(([, l]) => l)}
            value={TYPES.filter(([t]) => icp.buyerTypes.includes(t)).map(([, l]) => l)}
            onChange={(v) => set({ buyerTypes: TYPES.filter(([, l]) => v.includes(l)).map(([t]) => t) }, "buyerTypes")}
          />
        </Row>
        <Row label="State" aside={<span className="caps">{(counts[state] ?? 0).toLocaleString("en-US")} licensed</span>}>
          <p>
            {STATE_NAMES[state]} <em className="note text-sm">· click a shaded state to search there</em>
          </p>
          <div className="mt-2 max-w-md">
            <UsMap counts={counts} supported={SUPPORTED_STATES} selected={state} onSelect={pickState} />
          </div>
        </Row>
        {state === "CA" && (
          <Row label="Where in California" aside={guess("metros")}>
            <Chips options={METROS} value={zones} onChange={(v) => set({ metros: v }, "metros")} counts={leads.some((l) => l.state === "CA") ? zoneCounts : undefined} />
          </Row>
        )}
        <Row label="Already carries" aside={guess("portfolioFit")}>
          <Chips options={CARRIES} value={icp.portfolioFit} onChange={(v) => set({ portfolioFit: v }, "portfolioFit")} other="Something else" />
        </Row>
        <Row label="Size" aside={guess("sizeBand")}>
          <Chips multi={false} options={SIZES} value={[icp.sizeBand]} onChange={([v]) => set({ sizeBand: v }, "sizeBand")} />
        </Row>
        <Row label="US shelf price" aside={guess("priceBand")}>
          <Chips multi={false} options={PRICES} value={[icp.priceBand]} onChange={([v]) => set({ priceBand: v }, "priceBand")} />
        </Row>
      </div>

      <p className="caps mt-10 mb-1">Also worth trying</p>
      <div className="border-b border-rule">
        {icp.expansions.slice(0, 2).map((e) => {
          const st = stateInText(e.segment);
          return (
            <Row
              key={e.id}
              aside={
                st && st !== state ? (
                  <button className="btn-line whitespace-nowrap" onClick={() => pickState(st)}>Search {STATE_NAMES[st]}</button>
                ) : (
                  <button className={`chip ${e.status === "accepted" ? "chip-on" : ""}`} onClick={() => toggle(e.id)}>{e.status === "accepted" ? "✓ Added" : "Add"}</button>
                )
              }
            >
              <span title={e.rationale}>{e.segment}</span>
            </Row>
          );
        })}
      </div>

      <div className="mt-8 flex items-center justify-between gap-4">
        <Back href={onboarded ? "/home" : "/estate"} label={onboarded ? "Home" : "Your estate"} />
        <button className="btn" onClick={() => router.push("/search/importers")}>Find importers in {STATE_NAMES[state]}</button>
      </div>
    </Page>
  );
}
