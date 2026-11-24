"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Headline, Page } from "@/components/ui";
import { COST, useApp } from "@/lib/app-state";

const NUM = ["No letters", "One letter", "Two letters", "Three letters", "Four letters", "Five letters"];

/** Highlights the sentence built from the importer's signal, so Claire sees what's personal. */
function Body({ text, hook }: { text: string; hook?: string }) {
  if (!hook || !text.includes(hook)) return <>{text}</>;
  const [a, b] = text.split(hook);
  return (
    <>
      {a}
      <mark className="bg-highlight px-0.5 text-ink">{hook}</mark>
      {b}
    </>
  );
}

export default function Letters() {
  const router = useRouter();
  const { letters, leads, approve, skip, editLetter, credits, onboarded, finishOnboarding } = useApp();
  const queue = letters.filter((l) => l.status === "pending");
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [fr, setFr] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const cur = queue.find((l) => l.id === selected) ?? queue[0];
  const lead = cur && leads.find((l) => l.id === cur.leadId);

  if (!cur) {
    const sent = letters.filter((l) => l.status === "sent").length;
    return (
      <Page step={3}>
        <Headline lead={sent ? "All sent." : "No letters yet."} tail={sent ? "Now we wait." : "Pick an importer first."} />
        <p className="note mt-3 text-lg">{sent ? "We'll email you when someone replies." : "Choose who to write to on the importers step."}</p>
        <div className="mt-8">
          {sent ? (
            <button className="btn" onClick={() => { finishOnboarding(); router.push("/home"); }}>Go to my home</button>
          ) : (
            <Link href="/search/importers" className="btn">See importers</Link>
          )}
        </div>
      </Page>
    );
  }

  const startEdit = () => { setSubject(cur.subject); setBody(cur.body); setEditing(true); setFr(false); };
  const saveEdit = () => { editLetter(cur.id, { subject, body }); setEditing(false); };
  const go = (fn: (id: string) => void) => { fn(cur.id); setSelected(undefined); setEditing(false); setFr(false); };

  return (
    <Page step={3}>
      <Headline lead={NUM[Math.min(queue.length, 5)] ?? `${queue.length} letters`} tail="to approve." />
      <div className="mt-8 grid grid-cols-[180px_1fr] gap-10">
        <div className="min-w-0">
          {queue.map((l, i) => {
            const name = leads.find((x) => x.id === l.leadId)?.name;
            const on = l.id === cur.id;
            return (
              <button key={l.id} onClick={() => { setSelected(l.id); setEditing(false); setFr(false); }} className={`block w-full truncate border-t py-3 text-left font-serif text-lg ${on ? "border-wine text-wine" : "border-rule text-taupe hover:text-ink"} ${i === queue.length - 1 ? "border-b border-b-rule" : ""}`}>
                {name}
                {l.kind === "follow_up" && <span className="caps ml-2">follow-up</span>}
              </button>
            );
          })}
        </div>

        <article className="border border-rule bg-paper p-7">
          <p className="caps">To {lead?.contact?.name || lead?.name} {lead?.contact?.email && `· ${lead.contact.email}`}</p>
          {editing ? (
            <>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-2 w-full border-b border-rule bg-transparent font-serif text-2xl outline-none focus:border-wine" />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={11} className="mt-4 w-full resize-none bg-transparent font-serif text-lg leading-relaxed outline-none" />
            </>
          ) : (
            <>
              <h2 className="mt-2 font-serif text-2xl">{cur.subject}</h2>
              <p className="mt-4 font-serif text-lg leading-relaxed whitespace-pre-line">
                {fr && cur.bodyFr ? cur.bodyFr : <Body text={cur.body} hook={lead?.signals[0]} />}
              </p>
            </>
          )}
          {cur.bodyFr && !editing && (
            <button className="note mt-4 text-sm underline hover:text-ink" onClick={() => setFr(!fr)}>
              {fr ? "Back to English" : "Read in French"}
            </button>
          )}
        </article>
      </div>

      <div className="mt-6 flex items-center justify-end gap-6">
        {editing ? (
          <>
            <button className="caps hover:text-ink" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn" onClick={saveEdit}>Save letter</button>
          </>
        ) : (
          <>
            <button className="caps hover:text-ink" onClick={() => go(skip)}>Skip</button>
            <button className="caps underline hover:text-ink" onClick={startEdit}>Edit</button>
            <button className="btn" onClick={() => go(approve)} disabled={credits < COST.send} title={`Uses ${COST.send} credits`}>
              Approve and send
            </button>
          </>
        )}
      </div>
      {!onboarded && <p className="note mt-3 text-right text-sm">Sent from claire@petitespierres.fr · {COST.send} credits each</p>}
    </Page>
  );
}
