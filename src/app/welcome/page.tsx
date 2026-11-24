"use client";
import Link from "next/link";
import { Headline, Logo } from "@/components/ui";
import { useApp } from "@/lib/app-state";

const STEPS = [
  ["I", "Your estate", "2 min"],
  ["II", "Who should carry your wine", "1 min"],
  ["III", "Importers that fit", "5 min"],
  ["IV", "Your first letters", "2 min"],
];

export default function Welcome() {
  const { credits } = useApp();
  return (
    <main className="mx-auto max-w-3xl px-8 py-8">
      <Logo />
      <Headline lead="Welcome, Claire." tail="Let's find your importer." className="mt-14" />
      <p className="note mt-3 text-lg">Four steps, about ten minutes. Nothing is sent without you.</p>
      <div className="mt-8">
        {STEPS.map(([n, label, time], i) => (
          <div key={n} className={`grid grid-cols-[48px_1fr_auto] items-baseline border-t py-3 ${i === 0 ? "border-wine" : "border-rule"} ${i === 3 ? "border-b" : ""}`}>
            <span className={`font-serif text-xl ${i === 0 ? "text-wine" : "text-taupe"}`}>{n}</span>
            <span className="font-serif text-xl">{label}</span>
            <span className="caps">{time}</span>
          </div>
        ))}
      </div>
      <div className="mt-8 flex items-center justify-between">
        <span className="note">{credits} credits on us, enough for a first search.</span>
        <Link href="/estate" className="btn">Start with my estate</Link>
      </div>
    </main>
  );
}
