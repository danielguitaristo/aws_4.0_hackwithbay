"use client";
import { Headline, Page } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { STAGE_LABELS, type Lead, type Stage } from "@/lib/types";

const FUNNEL: Stage[] = ["contacted", "replied", "samples_sent", "tasting", "signed"];
const TYPE: Record<string, string> = { importer_distributor: "Importer-distributors", importer: "Importers", distributor: "Distributors" };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const reached = (l: Lead, s: Stage) => FUNNEL.indexOf(l.stage) >= FUNNEL.indexOf(s);

function Bar({ label, value, total, note }: { label: string; value: number; total: number; note?: string }) {
  return (
    <div className="grid grid-cols-[180px_1fr_110px] items-center gap-4 border-t border-rule py-3">
      <span className="font-serif text-lg">{label}</span>
      <div className="h-px bg-rule">
        <div className="h-px bg-ink" style={{ width: `${pct(value, total)}%` }} />
      </div>
      <span className="text-right font-serif text-lg">
        {value} <span className="note text-sm">{note ?? `${pct(value, total)}%`}</span>
      </span>
    </div>
  );
}

export default function Results() {
  const { leads, letters, events, ready } = useApp();
  if (!ready) return null;

  const active = leads.filter((l) => FUNNEL.includes(l.stage));
  const contacted = active.length;
  const replied = active.filter((l) => reached(l, "replied")).length;
  const tastings = active.filter((l) => reached(l, "tasting")).length;

  const sentIntro = letters.filter((l) => l.status === "sent" && (l.kind ?? "intro") === "intro");
  const variants = ["A", "B"].map((v) => {
    const ids = sentIntro.filter((l) => l.variant === v).map((l) => l.leadId);
    const got = active.filter((l) => ids.includes(l.id) && reached(l, "replied")).length;
    return { v, sent: ids.length, got };
  });
  const types = Object.keys(TYPE)
    .map((t) => {
      const group = active.filter((l) => l.type === t);
      return { t, n: group.length, got: group.filter((l) => reached(l, "replied")).length };
    })
    .filter((g) => g.n);
  const ai = events.filter((e) => e.actor === "agent").length;
  const you = events.filter((e) => e.actor === "rep").length;

  return (
    <Page>
      <Headline lead={`${pct(replied, contacted)}% replied,`} tail={tastings === 0 ? "no tasting yet." : `${tastings === 1 ? "one tasting" : `${tastings} tastings`} booked.`} />

      <p className="caps mt-10 mb-1">From first letter to signature</p>
      <div className="border-b border-rule">
        {FUNNEL.map((s, i) => {
          const n = active.filter((l) => reached(l, s)).length;
          const prev = i ? active.filter((l) => reached(l, FUNNEL[i - 1])).length : n;
          return <Bar key={s} label={STAGE_LABELS[s]} value={n} total={contacted} note={i ? `${pct(n, prev)}% of previous` : ""} />;
        })}
      </div>

      <div className="mt-12 grid grid-cols-2 gap-12">
        <div>
          <p className="caps mb-1">Which opening works</p>
          <div className="border-b border-rule">
            {variants.map(({ v, sent, got }) => (
              <Bar key={v} label={v === "A" ? "Their catalog first" : "Your estate first"} value={got} total={sent} note={`of ${sent} · ${pct(got, sent)}%`} />
            ))}
          </div>
        </div>
        <div>
          <p className="caps mb-1">Who answers</p>
          <div className="border-b border-rule">
            {types.map(({ t, n, got }) => (
              <Bar key={t} label={TYPE[t]} value={got} total={n} note={`of ${n} · ${pct(got, n)}%`} />
            ))}
          </div>
        </div>
      </div>

      <p className="note mt-10 text-lg">
        The assistant did {ai} things for you; you made {you} decisions. Nothing was sent without your approval.
      </p>
    </Page>
  );
}
