"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Headline, Page, SEARCH_STEP_NAMES } from "@/components/ui";
import { STATE_NAMES } from "@/components/UsMap";
import { firstNameOf, lastTouch, stateOf, useApp } from "@/lib/app-state";
import { stateInText } from "@/lib/places";

export default function Home() {
  const router = useRouter();
  const { leads, letters, events, replies, icp, draft, weekLater, ready, lastSearch, checkReplies, updateIcp } = useApp();

  // Real Gmail: look for replies when Home opens, then every 30 seconds while it stays open.
  useEffect(() => {
    if (!ready) return;
    checkReplies();
    const t = setInterval(checkReplies, 30000);
    return () => clearInterval(t);
  }, [ready, checkReplies]);

  // Demo helper: /home?demo=later jumps a week ahead (a reply + a follow-up to write).
  useEffect(() => {
    if (ready && window.location.search.includes("demo=later")) {
      weekLater();
      router.replace("/home");
    }
  }, [ready, weekLater, router]);

  if (!ready) return null;

  const replied = leads.filter((l) => l.stage === "replied" && replies[l.id] && !letters.some((x) => x.leadId === l.id && x.kind === "reply"));
  const pending = letters.filter((l) => l.status === "pending");
  const followUps = leads.filter((l) => {
    if (l.stage !== "contacted" || letters.some((x) => x.leadId === l.id && x.kind === "follow_up")) return false;
    const t = lastTouch(events, l.id);
    return t && t.days >= 7;
  });
  const sent = letters.filter((l) => l.status === "sent").length;
  // One row per state searched so far (the current one first).
  const searchStates = [...new Set([stateOf(icp), ...leads.map((l) => l.state || "CA")])];
  const top = replied[0];

  const write = async (leadId: string, kind: "reply" | "follow_up") => {
    await draft(leadId, kind);
    router.push("/search/letters");
  };

  const tail = top ? `${firstNameOf(top) ?? top.name} wrote back.` : pending.length ? "Letters are waiting." : "All quiet today.";
  const items = [
    ...replied.map((l, i) => (
      <div key={l.id} className={`flex flex-col items-start justify-between gap-3 border-t py-4 sm:flex-row sm:items-center sm:gap-6 ${i === 0 ? "border-wine" : "border-rule"}`}>
        <div>
          <span className="font-serif text-xl">{l.name} replied</span>
          <p className="note mt-1">&ldquo;{replies[l.id]}&rdquo;</p>
        </div>
        {i === 0 ? <button className="btn whitespace-nowrap" onClick={() => write(l.id, "reply")}>Draft a reply</button> : <button className="caps underline" onClick={() => write(l.id, "reply")}>Reply</button>}
      </div>
    )),
    pending.length > 0 && (
      <div key="pending" className={`flex flex-wrap items-baseline justify-between gap-x-4 border-t py-4 ${replied.length ? "border-rule" : "border-wine"}`}>
        <span className="font-serif text-xl">{pending.length} letter{pending.length > 1 ? "s" : ""} waiting for you</span>
        <Link href="/search/letters" className="caps underline hover:text-ink">Review</Link>
      </div>
    ),
    ...followUps.map((l) => (
      <div key={`f-${l.id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-rule py-4">
        <span className="font-serif text-xl">{l.name}, no answer in 7 days</span>
        <button className="caps underline hover:text-ink" onClick={() => write(l.id, "follow_up")}>Write a follow-up</button>
      </div>
    )),
  ].filter(Boolean);

  const nextSearch = icp?.expansions.find((e) => e.status === "accepted") ?? icp?.expansions[0];

  return (
    <Page>
      <Headline lead="Good morning, Claire." tail={tail} />
      <div className="mt-8 border-b border-rule">
        {items.length ? items : <p className="note border-t border-rule py-4">Nothing needs you today. We&apos;ll email you when an importer replies.</p>}
      </div>

      <div className="mt-12 mb-1 flex items-baseline justify-between">
        <span className="caps">Your searches</span>
        <Link href="/search/target" className="caps underline hover:text-ink">New search</Link>
      </div>
      {searchStates.map((st) => {
        const inState = leads.filter((l) => (l.state || "CA") === st && l.stage !== "lost");
        const sentHere = letters.filter((l) => l.status === "sent" && inState.some((x) => x.id === l.leadId)).length;
        const current = st === stateOf(icp);
        return (
          <Link key={st} href={current ? lastSearch : "/search/target"} onClick={() => !current && updateIcp({ states: [st], metros: [] })} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-rule py-4 hover:text-wine">
            <span className="font-serif text-xl">{STATE_NAMES[st]} importers</span>
            <span className="note">
              {sentHere > 0 || !current ? `${inState.length} found · ${sentHere} letter${sentHere === 1 ? "" : "s"} sent` : `Stopped at ${SEARCH_STEP_NAMES[lastSearch] ?? "Target"} · `}
              {sentHere === 0 && current && <span className="caps not-italic underline">Resume</span>}
            </span>
          </Link>
        );
      })}
      {nextSearch && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-y border-rule py-4">
          <span className="font-serif text-xl text-taupe">{nextSearch.segment}</span>
          <Link
            href="/search/target"
            onClick={() => { const st = stateInText(nextSearch.segment); if (st) updateIcp({ states: [st], metros: [] }); }}
            className="caps underline hover:text-ink"
          >
            {stateInText(nextSearch.segment) ? `Search ${STATE_NAMES[stateInText(nextSearch.segment)!]}` : "Start"}
          </Link>
        </div>
      )}
    </Page>
  );
}
