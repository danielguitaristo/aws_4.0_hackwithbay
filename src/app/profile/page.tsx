"use client";
import { useEffect, useState } from "react";
import { GmailDialog, Headline, Page, Row } from "@/components/ui";
import { useApp } from "@/lib/app-state";

export default function Profile() {
  const { gmail, gmailEmail, disconnectGmail } = useApp();
  const [ask, setAsk] = useState(false);
  const [back, setBack] = useState<string | null>(null);
  // Result of Google's consent screen (?gmail=connected | denied | error)
  useEffect(() => setBack(new URLSearchParams(window.location.search).get("gmail")), []);
  const [lang, setLang] = useState<"English" | "Français">("English");
  const [notify, setNotify] = useState({ results: true, replies: true });
  const toggle = (k: keyof typeof notify) => setNotify({ ...notify, [k]: !notify[k] });

  return (
    <Page>
      <Headline lead="Your" tail="profile." />
      <div className="mt-8 border-b border-rule">
        <Row label="Name" first>Claire Martin</Row>
        <Row
          label="Letters sent from"
          aside={
            gmail ? (
              <button className="caps underline hover:text-ink" onClick={disconnectGmail}>Disconnect</button>
            ) : (
              <button className="caps underline hover:text-ink" onClick={() => setAsk(true)}>Connect</button>
            )
          }
        >
          {gmail ? `${gmailEmail ?? "Your Gmail"} · Gmail ✓` : <em className="text-taupe">Gmail not connected yet</em>}
        </Row>
        <Row label="Signature">Claire Martin · Domaine des Petites Pierres</Row>
        <Row label="Language">
          <button className="hover:text-wine" onClick={() => setLang(lang === "English" ? "Français" : "English")}>{lang}</button>
        </Row>
        <Row label="Emails to you">
          {(["results", "replies"] as const).map((k) => (
            <label key={k} className="mr-6 inline-flex items-center gap-2">
              <input type="checkbox" checked={notify[k]} onChange={() => toggle(k)} className="accent-wine" />
              {k === "results" ? "Results ready" : "New reply"}
            </label>
          ))}
        </Row>
      </div>
      <p className="note mt-4">
        {back === "denied" ? "Gmail wasn't connected: you declined on Google's page." : back === "error" ? "Google didn't confirm the connection. Try again." : "Changes save on their own."}
      </p>
      {ask && <GmailDialog onClose={() => setAsk(false)} onDone={() => setAsk(false)} />}
    </Page>
  );
}
