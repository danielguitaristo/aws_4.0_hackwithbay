"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Back, GmailDialog, Headline, Page, TopUpDialog } from "@/components/ui";
import { COST, CREDITS, hookOf, useApp } from "@/lib/app-state";

const AFTER_GMAIL = "millesime-send-after-gmail";
const NUM =["No letters", "One letter", "Two letters", "Three letters", "Four letters", "Five letters"];

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
  const { letters, leads, sendLetter, skip, editLetter, credits, onboarded, finishOnboarding, gmail, gmailEmail, ready } = useApp();
  const [ask, setAsk] = useState<"gmail" | "credits" | null>(null);
  const queue = letters.filter((l) => l.status === "pending");
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [fr, setFr] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cur = queue.find((l) => l.id === selected) ?? queue[0];
  const lead = cur && leads.find((l) => l.id === cur.leadId);

  const doSend = async (id: string) => {
    setBusy(true);
    setError(null);
    const err = await sendLetter(id);
    setBusy(false);
    if (err === CREDITS) return setAsk("credits");
    if (err) return setError(err);
    setSelected(undefined);
    setEditing(false);
    setFr(false);
  };

  // Back from Google's consent screen: send the letter Claire had approved.
  useEffect(() => {
    if (!ready || !gmail) return;
    const id = sessionStorage.getItem(AFTER_GMAIL);
    if (!id) return;
    sessionStorage.removeItem(AFTER_GMAIL);
    if (letters.some((l) => l.id === id && l.status === "pending")) doSend(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, gmail]);

  if (!cur) {
    const sent = letters.filter((l) => l.status === "sent").length;
    return (
      <Page step={3}>
        <Headline lead={sent ? "All sent." : "No letters yet."} tail={sent ? "Now we wait." : "Pick an importer first."} />
        <p className="note mt-3 text-lg">{sent ? "We'll email you when someone replies." : "Choose who to write to on the importers step."}</p>
        <div className="mt-8 flex flex-wrap items-center gap-6">
          {sent ? (
            <>
              <button className="btn" onClick={() => { finishOnboarding(); router.push("/home"); }}>Go to my home</button>
              <Link href="/search/importers" className="btn-line">Write to more importers</Link>
            </>
          ) : (
            <Link href="/search/importers" className="btn">See importers</Link>
          )}
        </div>
      </Page>
    );
  }

  const recipient = cur.to ?? lead?.contact?.email ?? "";
  const startEdit = () => { setSubject(cur.subject); setBody(cur.body); setTo(recipient); setEditing(true); setFr(false); };
  const saveEdit = () => { editLetter(cur.id, { subject, body, to: to.trim() || undefined }); setEditing(false); };
  const go = (fn: (id: string) => void) => { fn(cur.id); setSelected(undefined); setEditing(false); setFr(false); };
  // Gmail is asked at the first send; credits are checked right after, both without losing the letter.
  const send = () => (!gmail ? setAsk("gmail") : credits < COST.send ? setAsk("credits") : doSend(cur.id));

  return (
    <Page step={3}>
      <Headline lead={NUM[Math.min(queue.length, 5)] ?? `${queue.length} letters`} tail="to approve." />
      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-[180px_1fr] md:gap-10">
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

        <article className="min-w-0 border border-rule bg-paper p-5 sm:p-7">
          {editing ? (
            <>
              <label className="caps flex items-baseline gap-3">
                To
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@importer.com" className="flex-1 border-b border-rule bg-transparent font-serif text-base tracking-normal normal-case text-ink outline-none focus:border-wine" />
              </label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-2 w-full border-b border-rule bg-transparent font-serif text-2xl outline-none focus:border-wine" />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={11} className="mt-4 w-full resize-none bg-transparent font-serif text-lg leading-relaxed outline-none" />
            </>
          ) : (
            <>
              <p className="caps break-words">
                To {lead?.contact?.name || lead?.name} {recipient ? `· ${recipient}` : <em className="normal-case">· no email yet, use Edit</em>}
              </p>
              <h2 className="mt-2 font-serif text-2xl">{cur.subject}</h2>
              <p className="mt-4 font-serif text-lg leading-relaxed whitespace-pre-line">
                {fr && cur.bodyFr ? cur.bodyFr : <Body text={cur.body} hook={lead && hookOf(lead)} />}
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

      <div className="mt-6 flex flex-wrap items-center justify-end gap-6">
        {!editing && <span className="mr-auto"><Back href="/search/importers" label="Importers" /></span>}
        {editing ? (
          <>
            <button className="link" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn" onClick={saveEdit}>Save letter</button>
          </>
        ) : (
          <>
            <button className="link" onClick={() => go(skip)}>Skip</button>
            <button className="btn-line" onClick={startEdit}>Edit</button>
            <button className="btn" onClick={send} disabled={busy} title={`Uses ${COST.send} credits`}>
              {busy ? "Sending…" : gmail ? "Approve and send" : "Approve · connect Gmail"}
            </button>
          </>
        )}
      </div>
      {error && <p className="note mt-3 text-right text-wine">{error}</p>}
      {!onboarded && <p className="note mt-3 text-right text-sm">{gmail ? `Sent from ${gmailEmail ?? "your Gmail"}` : "Sent from your Gmail"} · {COST.send} credits each</p>}
      {ask === "gmail" && (
        <GmailDialog
          beforeRedirect={() => sessionStorage.setItem(AFTER_GMAIL, cur.id)}
          onClose={() => setAsk(null)}
          onDone={() => { setAsk(null); if (credits < COST.send) setAsk("credits"); else doSend(cur.id); }}
        />
      )}
      {ask === "credits" && <TopUpDialog need={COST.send} action="Sending a letter" onClose={() => setAsk(null)} onDone={() => { setAsk(null); doSend(cur.id); }} />}
    </Page>
  );
}
