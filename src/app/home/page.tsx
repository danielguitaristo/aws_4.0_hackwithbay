"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Headline, Page, SEARCH_STEP_NAMES } from "@/components/ui";
import { lastTouch, useApp } from "@/lib/app-state";

export default function Home() {
  const router = useRouter();
  const { leads, letters, events, replies, icp, draft, weekLater, ready, lastSearch } = useApp();

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
  const found = leads.filter((l) => l.stage !== "lost").length;
  const top = replied[0];

  const write = async (leadId: string, kind: "reply" | "follow_up") => {
    await draft(leadId, kind);
    router.push("/search/letters");
  };

  const tail = top ? `${top.contact?.name?.split(" ")[0] ?? top.name} wrote back.` : pending.length ? "Letters are waiting." : "All quiet today.";
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
      <Link href={lastSearch} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-rule py-4 hover:text-wine">
        <span className="font-serif text-xl">California importers</span>
        <span className="note">
          {sent > 0 ? `${found} found · ${sent} letter${sent === 1 ? "" : "s"} sent` : `Stopped at ${SEARCH_STEP_NAMES[lastSearch] ?? "Target"} · `}
          {sent === 0 && <span className="caps not-italic underline">Resume</span>}
        </span>
      </Link>
      {nextSearch && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-y border-rule py-4">
          <span className="font-serif text-xl text-taupe">{nextSearch.segment}</span>
          <Link href="/search/target" className="caps underline hover:text-ink">Start</Link>
        </div>
      )}
    </Page>
  );
}
