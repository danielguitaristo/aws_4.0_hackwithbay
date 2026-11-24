"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
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
const ONBOARDING = ["Estate", "Importer", "Importers", "Letters"];
const SEARCH = ["Target", "Importers", "Letters"];

/** Roman-numeral steps; only the current one is spelled out, in burgundy — job #2. */
export function Steps({ current }: { current: number }) {
  const { onboarded } = useApp();
  const labels = onboarded ? SEARCH : ONBOARDING;
  const idx = onboarded ? current - 1 : current;
  return (
    <div className="flex gap-6">
      {onboarded && <span className="caps">California ·</span>}
      {labels.map((l, i) => (
        <span key={l} className={`caps ${i === idx ? "text-wine" : ""}`}>
          {ROMAN[i]}
          {i === idx && ` · ${l}`}
        </span>
      ))}
    </div>
  );
}

/** Top bar. During the first visit it shows only the logo and steps, to keep Claire focused. */
export function TopBar({ step }: { step?: number }) {
  const { onboarded, credits } = useApp();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const tabs = [
    ["Home", "/home"],
    ["Searches", "/search/importers"],
    ["Relationships", "/relationships"],
  ];
  return (
    <header className="flex items-baseline justify-between gap-6">
      <Link href={onboarded ? "/home" : "/"}>
        <Logo />
      </Link>
      {onboarded ? (
        <nav className="flex gap-6">
          {tabs.map(([label, href]) => (
            <Link key={href} href={href} className={`caps hover:text-ink ${path.startsWith(href.split("/").slice(0, 2).join("/")) ? "text-wine" : ""}`}>
              {label}
            </Link>
          ))}
        </nav>
      ) : (
        step !== undefined && <Steps current={step} />
      )}
      <div className="relative">
        <button onClick={() => setOpen(!open)} className="caps hover:text-ink" aria-expanded={open}>
          CL
        </button>
        {open && (
          <div className="absolute right-0 z-10 mt-3 w-44 border border-rule bg-paper py-2">
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
          </div>
        )}
      </div>
    </header>
  );
}

export function Page({ children, step, wide = false }: { children: React.ReactNode; step?: number; wide?: boolean }) {
  const { onboarded } = useApp();
  return (
    <main className={`mx-auto px-8 py-8 ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
      <TopBar step={step} />
      {onboarded && step !== undefined && step > 0 && (
        <div className="mt-8">
          <Steps current={step} />
        </div>
      )}
      <div className="mt-12">{children}</div>
    </main>
  );
}

/** A ruled line: field name on the left, value on the right. */
export function Row({ label, children, aside, first = false }: { label?: string; children: React.ReactNode; aside?: React.ReactNode; first?: boolean }) {
  return (
    <div className={`grid grid-cols-[170px_1fr_auto] items-baseline gap-4 border-t py-3 ${first ? "border-wine" : "border-rule"}`}>
      <span className="caps">{label}</span>
      <div className="font-serif text-lg">{children}</div>
      <div>{aside}</div>
    </div>
  );
}
