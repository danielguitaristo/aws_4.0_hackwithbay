"use client";
import Link from "next/link";
import { useState } from "react";
import { Chips, Headline, Page } from "@/components/ui";
import { lastTouch, useApp } from "@/lib/app-state";
import { STAGE_LABELS, type Stage } from "@/lib/types";

const MET = ["Wine Paris", "ProWein", "Visited the estate", "Introduced by a friend", "Met in the US"];
const COLUMNS: Stage[] = ["contacted", "replied", "samples_sent", "tasting", "signed"];
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const word = (n: number) => WORDS[n] ?? String(n);

export default function Relationships() {
  const { leads, events, moveStage, addLead, ready } = useApp();
  const [dragging, setDragging] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", note: "" });

  if (!ready) return null;
  const active = leads.filter((l) => COLUMNS.includes(l.stage));
  const talking = active.filter((l) => l.stage !== "contacted").length;
  const replied = active.length ? Math.round((talking / active.length) * 100) : 0;

  const submit = () => {
    if (!form.name.trim()) return;
    addLead(form.name.trim(), form.email.trim(), form.note.trim());
    setForm({ name: "", email: "", note: "" });
    setAdding(false);
  };

  return (
    <Page wide>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <Headline lead={`${word(active.length)} importer${active.length === 1 ? "" : "s"},`} tail={`${word(talking).toLowerCase()} talking with you.`} />
        <button className="btn-line whitespace-nowrap" onClick={() => setAdding(!adding)}>+ Add one you know</button>
      </div>

      {adding && (
        <div className="mt-6 border-t border-wine pt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(["name", "email"] as const).map((k) => (
              <label key={k} className="block">
                <span className="caps">{k === "name" ? "Importer" : "Email"}</span>
                <input value={form[k]} placeholder={k === "name" ? "Importer name" : "name@importer.com"} onChange={(e) => setForm({ ...form, [k]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} className="mt-1 w-full border-b border-taupe bg-transparent py-1 font-serif text-lg outline-none focus:border-wine" />
              </label>
            ))}
          </div>
          <p className="caps mt-4 mb-2">Where you met</p>
          <Chips multi={false} options={MET} value={form.note ? [form.note] : []} onChange={([v]) => setForm({ ...form, note: v })} other="Somewhere else" />
          <div className="mt-4 flex justify-end">
            <button className="btn" onClick={submit} disabled={!form.name.trim()}>Add to relationships</button>
          </div>
        </div>
      )}

      <div className="-mx-5 mt-10 overflow-x-auto px-5 sm:mx-0 sm:px-0"><div className="grid min-w-[720px] grid-cols-5 gap-5">
        {COLUMNS.map((stage) => {
          const cards = active.filter((l) => l.stage === stage);
          const hot = stage === "replied" && cards.length > 0;
          return (
            <div
              key={stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragging) moveStage(dragging, stage, "rep"); setDragging(undefined); }}
              className="min-h-48"
            >
              <div className="flex justify-between border-b border-rule pb-2">
                <span className={`caps ${hot ? "text-wine" : ""}`}>{STAGE_LABELS[stage]}</span>
                <span className={`font-serif ${hot ? "text-wine" : ""}`}>{cards.length}</span>
              </div>
              {cards.map((l) => {
                const t = lastTouch(events, l.id);
                const late = stage === "contacted" && t && t.days >= 7;
                return (
                  <div key={l.id} draggable onDragStart={() => setDragging(l.id)} className={`cursor-grab border-b border-rule py-3 active:cursor-grabbing ${hot ? "border-t border-t-wine" : ""}`}>
                    <span className={`block font-serif text-lg leading-tight ${hot ? "text-wine" : ""}`}>{l.name}</span>
                    {t && (
                      <span className="text-[10px] tracking-wider text-taupe uppercase">
                        {t.actor} · {t.ago}
                        {late ? " · follow up" : t.note && t.actor === "You" ? ` · ${t.note}` : ""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div></div>
      {active.length > 0 && (
        <p className="note mt-8 text-lg">
          {replied}% replied.{" "}
          <Link href="/results" className="btn-line not-italic">See results</Link>
          <span className="caps ml-6 not-italic">Drag a card to move it</span>
        </p>
      )}
    </Page>
  );
}
