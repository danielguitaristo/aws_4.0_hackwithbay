"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Headline, Page, Row } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import type { Domaine } from "@/lib/types";

type Field = { key: keyof Domaine; label: string; show: (d: Domaine) => string; parse: (v: string) => Partial<Domaine> };
const list = (v: string) => v.split(/[·,]/).map((x) => x.trim()).filter(Boolean);

const FIELDS: Field[] = [
  { key: "name", label: "Name", show: (d) => d.name, parse: (v) => ({ name: v }) },
  { key: "appellations", label: "Appellations", show: (d) => d.appellations.join(" · "), parse: (v) => ({ appellations: list(v) }) },
  { key: "grapes", label: "Grapes", show: (d) => d.grapes.join(" · "), parse: (v) => ({ grapes: list(v) }) },
  { key: "certifications", label: "Farming", show: (d) => d.certifications.join(" · "), parse: (v) => ({ certifications: list(v) }) },
  {
    key: "priceRangeEur", label: "Price ex-cellar", show: (d) => `€${d.priceRangeEur.min} – ${d.priceRangeEur.max}`,
    parse: (v) => { const [min, max] = v.replace(/[€\s]/g, "").split(/[-–]/).map(Number); return { priceRangeEur: { min: min || 0, max: max || min || 0 } }; },
  },
  { key: "exportBottles", label: "Bottles for the US", show: (d) => (d.exportBottles ? d.exportBottles.toLocaleString("en-US") : ""), parse: (v) => ({ exportBottles: Number(v.replace(/\D/g, "")) || 0 }) },
];

export default function Estate() {
  const router = useRouter();
  const { domaine, saveDomaine, buildIcp, onboarded } = useApp();
  const [editing, setEditing] = useState<keyof Domaine | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const commit = (f: Field) => {
    saveDomaine(f.parse(draft));
    setEditing(null);
  };

  const next = async () => {
    setBusy(true);
    await buildIcp();
    router.push("/search/target");
  };

  return (
    <Page step={onboarded ? undefined : 0}>
      <Headline lead="Your estate," tail="as we read it." />
      <div className="mt-8">
        <Row label="Website" first>petitespierres.fr</Row>
        {FIELDS.map((f, i) => (
          <div key={f.key} className={i === FIELDS.length - 1 ? "border-b border-rule" : ""}>
            <Row label={f.label}>
              {editing === f.key ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(f)}
                  onKeyDown={(e) => e.key === "Enter" && commit(f)}
                  className="w-full border-b border-wine bg-transparent outline-none"
                />
              ) : (
                <button className="text-left hover:text-wine" onClick={() => { setEditing(f.key); setDraft(f.show(domaine)); }}>
                  {f.show(domaine) || <em className="text-taupe underline">add a number</em>}
                </button>
              )}
            </Row>
          </div>
        ))}
      </div>
      <div className="mt-8 flex items-center justify-between">
        <span className="note">Click any line to change it.</span>
        {onboarded ? (
          <span className="note">Changes save on their own.</span>
        ) : (
          <button className="btn" onClick={next} disabled={busy}>{busy ? "Reading your estate…" : "Looks right"}</button>
        )}
      </div>
    </Page>
  );
}
