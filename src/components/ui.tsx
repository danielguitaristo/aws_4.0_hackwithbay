"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-state";

export function Logo({ size = "text-xl" }: { size?: string }) {
  return <span className={`font-serif font-light italic ${size}`}>millésime</span>;
}

/** Headline with the italic burgundy ending — burgundy job #1. */
export function Headline({ lead, tail, className = "" }: { lead: string; tail: string; className?: string }) {
  return (
    <h1 className={`headline ${className}`}>
      {lead} <em className="text-wine">{tail}</em>
    </h1>
  );
}

const ROMAN = ["I", "II", "III", "IV"];
const ONBOARDING: [string, string][] = [["Estate", "/estate"], ["Importer", "/search/target"], ["Importers", "/search/importers"], ["Letters", "/search/letters"]];
const SEARCH = ONBOARDING.slice(1);
export const SEARCH_STEP_NAMES: Record<string, string> = { "/search/target": "Target", "/search/importers": "Importers", "/search/letters": "Letters" };

/** Roman-numeral steps; the current one is spelled out in burgundy (job #2). Every step is a link, so Claire can go back. */
export function Steps({ current }: { current: number }) {
  const { onboarded } = useApp();
  const steps = onboarded ? SEARCH : ONBOARDING;
  const idx = onboarded ? current - 1 : current;
  return (
    <nav className="flex flex-wrap items-baseline gap-x-6 gap-y-2" aria-label="Steps">
      {onboarded && <span className="caps">California ·</span>}
      {steps.map(([label, href], i) => (
        <Link key={href} href={href} aria-current={i === idx ? "step" : undefined} className={`caps hover:text-ink ${i === idx ? "text-wine" : ""}`}>
          {ROMAN[i]}
          {i === idx && ` · ${label}`}
        </Link>
      ))}
    </nav>
  );
}

/** Top bar. During the first visit: logo, steps and "Finish later" only, to keep Claire focused. */
export function TopBar({ step }: { step?: number }) {
  const { onboarded, credits, finishOnboarding } = useApp();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const tabs = [
    ["Home", "/home"],
    ["Searches", "/search"],
    ["Relationships", "/relationships"],
  ];
  const later = () => {
    finishOnboarding();
    router.push("/home");
  };
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
      <Link href={onboarded ? "/home" : "/"}>
        <Logo />
      </Link>
      {onboarded ? (
        <nav className="order-3 flex w-full gap-6 sm:order-none sm:w-auto">
          {tabs.map(([label, href]) => (
            <Link key={href} href={href === "/search" ? "/search/importers" : href} className={`caps hover:text-ink ${path.startsWith(href) ? "text-wine" : ""}`}>
              {label}
            </Link>
          ))}
        </nav>
      ) : (
        step !== undefined && (
          <div className="order-3 w-full sm:order-none sm:w-auto">
            <Steps current={step} />
          </div>
        )
      )}
      <div className="relative flex items-baseline gap-6">
        {!onboarded && step !== undefined && step > 0 && (
          <button onClick={later} className="caps underline hover:text-ink">Finish later</button>
        )}
        <button onClick={() => setOpen(!open)} className="caps hover:text-ink" aria-expanded={open}>
          CL
        </button>
        {open && (
          <div className="absolute top-6 right-0 z-10 w-44 border border-rule bg-paper py-2">
            {[
              ["Your estate", "/estate"],
              ["Profile", "/profile"],
              [`Credits · ${credits}`, "/credits"],
            ].map(([l, h]) => (
              <Link key={h} href={h} className="block px-4 py-2 font-serif text-base hover:bg-sand" onClick={() => setOpen(false)}>
                {l}
              </Link>
            ))}
            <button className="block w-full px-4 py-2 text-left font-serif text-base text-taupe hover:bg-sand" onClick={() => router.push("/")}>
              Sign out
            </button>
            <button
              className="block w-full border-t border-rule px-4 py-2 text-left font-serif text-base text-taupe hover:bg-sand"
              onClick={() => { if (window.confirm("Start over? This clears your estate, searches and letters on this device.")) window.location.href = "/?reset"; }}
            >
              Start over
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function Page({ children, step, wide = false }: { children: React.ReactNode; step?: number; wide?: boolean }) {
  const { onboarded, rememberSearch } = useApp();
  const path = usePathname();
  // remember where Claire stopped in her search, so Home can offer "Resume"
  useEffect(() => {
    if (step && step > 0) rememberSearch(path);
  }, [step, path, rememberSearch]);
  return (
    <main className={`mx-auto px-5 py-6 sm:px-8 sm:py-8 ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
      <TopBar step={step} />
      {onboarded && step !== undefined && step > 0 && (
        <div className="mt-6 sm:mt-8">
          <Steps current={step} />
        </div>
      )}
      <div className="mt-10 sm:mt-12">{children}</div>
    </main>
  );
}

/** "Back" link shown beside a step's main action. */
export function Back({ href, label = "Back" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="caps hover:text-ink">
      ‹ {label}
    </Link>
  );
}

/** Centered dialog on a soft scrim. Esc or a click outside closes it. */
export function Dialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-md border border-rule bg-cream p-7" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const PACK = { credits: 200, price: 20 };

/** Shown when an action costs more than the balance: top up in place, then the action runs. */
export function TopUpDialog({ need, action, onDone, onClose }: { need: number; action: string; onDone: () => void; onClose: () => void }) {
  const { credits, topUp } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog onClose={onClose}>
      <h2 className="headline text-3xl">
        Not enough <em className="text-wine">credits.</em>
      </h2>
      <p className="note mt-3">
        {action} uses {need} credits; you have {credits}. Add {PACK.credits} credits for ${PACK.price} and we&apos;ll carry on.
      </p>
      <div className="mt-6 flex items-center justify-between gap-4">
        <button className="caps hover:text-ink" onClick={onClose}>Not now</button>
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await topUp(PACK.credits); onDone(); }}>
          {busy ? "Adding…" : `Add ${PACK.credits} credits`}
        </button>
      </div>
    </Dialog>
  );
}

/** Asked at the first send, not at sign-in: permission comes after Claire has seen the value. */
export function GmailDialog({ onDone, onClose, beforeRedirect }: { onDone: () => void; onClose: () => void; beforeRedirect?: () => void }) {
  const { connectGmail, gmailReal } = useApp();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    if (gmailReal) beforeRedirect?.(); // the page is about to leave for Google's consent screen
    if (await connectGmail()) onDone();
  };
  return (
    <Dialog onClose={onClose}>
      <h2 className="headline text-3xl">
        Send from <em className="text-wine">your own address.</em>
      </h2>
      <p className="note mt-3">
        Importers answer people, not tools. Connect Gmail and your letters leave from claire@petitespierres.fr. We only send what you approve, and only read replies to these letters. You can disconnect anytime in your profile.
      </p>
      <div className="mt-6 flex items-center justify-between gap-4">
        <button className="caps hover:text-ink" onClick={onClose}>Not now</button>
        <button className="btn" onClick={go} disabled={busy}>{busy ? "Connecting…" : "Connect Gmail"}</button>
      </div>
    </Dialog>
  );
}

/** A ruled line: field name on the left (above on phones), value on the right. */
export function Row({ label, children, aside, first = false }: { label?: string; children: React.ReactNode; aside?: React.ReactNode; first?: boolean }) {
  return (
    <div className={`grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 border-t py-3 sm:grid-cols-[170px_1fr_auto] ${first ? "border-wine" : "border-rule"}`}>
      {label !== undefined && <span className="caps col-span-2 sm:col-span-1">{label}</span>}
      {label === undefined && <span className="hidden sm:block" />}
      <div className="min-w-0 font-serif text-lg">{children}</div>
      <div>{aside}</div>
    </div>
  );
}
