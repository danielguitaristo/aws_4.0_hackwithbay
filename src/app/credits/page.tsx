"use client";
import { useState } from "react";
import { Headline, Page } from "@/components/ui";
import { COST, useApp } from "@/lib/app-state";

const PACKS = [
  { credits: 100, price: 12 },
  { credits: 200, price: 20 },
  { credits: 500, price: 45 },
];

export default function Credits() {
  const { credits, topUp, events, leads } = useApp();
  const [pick, setPick] = useState(1);
  const [costs, setCosts] = useState(false);
  const [history, setHistory] = useState(false);
  const spent = events.filter((e) => e.type === "enriched" || e.type === "sent").reverse();

  return (
    <Page>
      <Headline lead={`${credits} credits`} tail="left." />
      <p className="note mt-2 text-lg">
        Enough for about {Math.floor(credits / (COST.contact + COST.send))} contacts.{" "}
        <button className="caps not-italic underline hover:text-ink" onClick={() => setCosts(!costs)}>What uses credits</button>
      </p>
      {costs && (
        <div className="mt-4 space-y-1 border-l border-rule pl-4 text-sm text-taupe">
          <p>Finding an importer&apos;s contact · {COST.contact} credits</p>
          <p>Sending a letter · {COST.send} credits</p>
          <p>Searching and drafting · free</p>
        </div>
      )}

      <div className="mt-10 grid grid-cols-3 gap-6">
        {PACKS.map((p, i) => (
          <button key={p.credits} onClick={() => setPick(i)} className={`border-t py-4 text-center ${i === pick ? "border-wine" : "border-rule"}`}>
            <span className={`block font-serif text-3xl ${i === pick ? "text-wine" : ""}`}>{p.credits}</span>
            <span className="caps">${p.price}</span>
          </button>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between">
        <button className="caps underline hover:text-ink" onClick={() => setHistory(!history)}>History</button>
        <button className="btn" onClick={() => topUp(PACKS[pick].credits)}>Add {PACKS[pick].credits} credits</button>
      </div>
      {history && (
        <div className="mt-6">
          {spent.length === 0 && <p className="note">Nothing spent yet.</p>}
          {spent.map((e) => (
            <div key={e.id} className="flex justify-between border-t border-rule py-2 font-serif">
              <span>{e.type === "sent" ? "Letter sent" : "Contact found"} · {leads.find((l) => l.id === e.leadId)?.name}</span>
              <span className="text-taupe">−{e.type === "sent" ? COST.send : COST.contact}</span>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
