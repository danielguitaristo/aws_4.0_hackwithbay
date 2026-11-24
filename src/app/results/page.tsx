"use client";
import { Headline, Page } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { STAGE_LABELS, type Lead, type Stage } from "@/lib/types";

const FUNNEL: Stage[] = ["contacted", "replied", "samples_sent", "tasting", "signed"];
const TYPE: Record<string, string> = { importer_distributor: "Importer-distributors", importer: "Importers", distributor: "Distributors" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const reached = (l: Lead, s: Stage) => FUNNEL.indexOf(l.stage) >= FUNNEL.indexOf(s);

/** A plain table: name, count, rate — each in its own labelled column. */
function Table({ title, cols, rows }: { title: string; cols: [string, string]; rows: [string, number, string][] }) {
  return (
    <div>
      <div className="grid grid-cols-[1fr_44px_52px] sm:grid-cols-[1fr_80px_90px] items-baseline gap-4 pb-2">
        <span className="caps">{title}</span>
        <span className="caps text-right">{cols[0]}</span>
        <span className="caps text-right">{cols[1]}</span>
      </div>
      {rows.map(([label, n, rate], i) => (
        <div key={label} className={`grid grid-cols-[1fr_44px_52px] sm:grid-cols-[1fr_80px_90px] items-baseline gap-4 border-t py-3 font-serif text-lg ${i === rows.length - 1 ? "border-b" : ""} border-rule`}>
          <span className="min-w-0 truncate">{label}</span>
          <span className="text-right">{n}</span>
          <span className="text-right text-taupe">{rate}</span>
        </div>
      ))}
    </div>
  );
}

export default function Results() {
  const { leads, letters, ready } = useApp();
  if (!ready) return null;

  const active = leads.filter((l) => FUNNEL.includes(l.stage));
  const count = (s: Stage) => active.filter((l) => reached(l, s)).length;
  const replied = count("replied");
  const tastings = count("tasting");

  const funnel: [string, number, string][] = FUNNEL.map((s, i) => [STAGE_LABELS[s], count(s), i ? pct(count(s), count(FUNNEL[i - 1])) : ""]);

  const sentIntro = letters.filter((l) => l.status === "sent" && (l.kind ?? "intro") === "intro");
  const openings: [string, number, string][] = ["A", "B"].map((v) => {
    const ids = sentIntro.filter((l) => l.variant === v).map((l) => l.leadId);
    const got = active.filter((l) => ids.includes(l.id) && reached(l, "replied")).length;
    return [v === "A" ? "Their catalog first" : "Your estate first", ids.length, pct(got, ids.length)];
  });

  const types: [string, number, string][] = Object.keys(TYPE)
    .map((t) => {
      const group = active.filter((l) => l.type === t);
      return [TYPE[t], group.length, pct(group.filter((l) => reached(l, "replied")).length, group.length)] as [string, number, string];
    })
    .filter(([, n]) => n > 0);

  return (
    <Page>
      <Headline lead={`${pct(replied, active.length)} replied,`} tail={tastings === 0 ? "no tasting yet." : `${tastings === 1 ? "one tasting" : `${tastings} tastings`} booked.`} />
      <div className="mt-10">
        <Table title="From first letter to signature" cols={["Importers", "Kept"]} rows={funnel} />
      </div>
      <div className="mt-12 grid grid-cols-1 gap-12 md:grid-cols-2">
        <Table title="Which opening works" cols={["Sent", "Replied"]} rows={openings} />
        <Table title="Who answers" cols={["Sent", "Replied"]} rows={types} />
      </div>
    </Page>
  );
}
