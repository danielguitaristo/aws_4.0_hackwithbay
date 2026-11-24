"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chips, Headline, Page, Row } from "@/components/ui";
import { useApp } from "@/lib/app-state";

// Pre-filled answers: Claire confirms or adjusts instead of typing.
const APPELLATIONS = ["Touraine", "Vouvray", "Montlouis", "Chinon", "Bourgueil", "Saumur", "Anjou", "Sancerre", "Muscadet"];
const GRAPES = ["Chenin Blanc", "Cabernet Franc", "Sauvignon Blanc", "Gamay", "Melon de Bourgogne", "Pinot Noir", "Côt (Malbec)"];
const FARMING = ["Conventional", "Sustainable (HVE)", "AB (organic)", "Biodynamic (Demeter)", "low-intervention"];
const PRICES: [string, number, number][] = [["€5 – 10", 5, 10], ["€9 – 22", 9, 22], ["€15 – 30", 15, 30], ["€25 – 50", 25, 50], ["€50+", 50, 100]];
const VOLUMES: [string, number][] = [["1,000", 1000], ["3,000", 3000], ["6,000", 6000], ["12,000", 12000], ["25,000+", 25000]];

export default function Estate() {
  const router = useRouter();
  const { domaine: d, saveDomaine, buildIcp, onboarded } = useApp();
  const [busy, setBusy] = useState(false);

  const price = PRICES.find(([, min, max]) => min === d.priceRangeEur.min && max === d.priceRangeEur.max)?.[0] ?? `€${d.priceRangeEur.min} – ${d.priceRangeEur.max}`;
  const volume = VOLUMES.find(([, n]) => n === d.exportBottles)?.[0] ?? d.exportBottles.toLocaleString("en-US");

  const next = async () => {
    setBusy(true);
    await buildIcp();
    router.push("/search/target");
  };

  return (
    <Page step={onboarded ? undefined : 0}>
      <Headline lead="Your estate," tail="as we read it." />
      <p className="note mt-3 text-lg">We filled this in from petitespierres.fr. Tap to adjust.</p>
      <div className="mt-8 border-b border-rule">
        <Row label="Name" first>
          <input value={d.name} onChange={(e) => saveDomaine({ name: e.target.value })} className="w-full border-b border-transparent bg-transparent outline-none hover:border-rule focus:border-wine" />
        </Row>
        <Row label="Appellations">
          <Chips options={APPELLATIONS} value={d.appellations} onChange={(v) => saveDomaine({ appellations: v })} other="Another appellation" />
        </Row>
        <Row label="Grapes">
          <Chips options={GRAPES} value={d.grapes} onChange={(v) => saveDomaine({ grapes: v })} other="Another grape" />
        </Row>
        <Row label="Farming">
          <Chips options={FARMING} value={d.certifications} onChange={(v) => saveDomaine({ certifications: v })} />
        </Row>
        <Row label="Price ex-cellar">
          <Chips
            multi={false}
            options={PRICES.map(([l]) => l)}
            value={[price]}
            onChange={([l]) => { const p = PRICES.find(([x]) => x === l); if (p) saveDomaine({ priceRangeEur: { min: p[1], max: p[2] } }); }}
          />
        </Row>
        <Row label="Bottles for the US">
          <Chips
            multi={false}
            options={VOLUMES.map(([l]) => l)}
            value={[volume]}
            onChange={([l]) => { const v = VOLUMES.find(([x]) => x === l); if (v) saveDomaine({ exportBottles: v[1] }); }}
          />
        </Row>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-end gap-4">
        {onboarded ? (
          <span className="note">Changes save on their own.</span>
        ) : (
          <button className="btn" onClick={next} disabled={busy}>{busy ? "Reading your estate…" : "Looks right"}</button>
        )}
      </div>
    </Page>
  );
}
