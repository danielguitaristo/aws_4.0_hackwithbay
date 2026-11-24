"use client";
import { useState } from "react";
import { Headline, Page, Row } from "@/components/ui";

export default function Profile() {
  const [lang, setLang] = useState<"English" | "Français">("English");
  const [notify, setNotify] = useState({ results: true, replies: true });
  const toggle = (k: keyof typeof notify) => setNotify({ ...notify, [k]: !notify[k] });

  return (
    <Page>
      <Headline lead="Your" tail="profile." />
      <div className="mt-8 border-b border-rule">
        <Row label="Name" first>Claire Martin</Row>
        <Row label="Letters sent from" aside={<span className="caps">Gmail ✓</span>}>claire@petitespierres.fr</Row>
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
      <p className="note mt-4">Changes save on their own.</p>
    </Page>
  );
}
