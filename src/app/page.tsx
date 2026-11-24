"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UsMap } from "@/components/UsMap";
import { Headline, Logo } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { SUPPORTED_STATES } from "@/lib/places";

// Sign in. Simulated for the demo: no real auth, the link "arrives" instantly.
export default function SignIn() {
  const router = useRouter();
  const { onboarded } = useApp();
  const [email, setEmail] = useState("claire@petitespierres.fr");
  const [sent, setSent] = useState(false);
  const valid = /\S+@\S+\.\S+/.test(email);
  // the whole US market, shaded by licensed importers (TTB)
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch("/api/states").then((r) => r.json()).then((d) => setCounts(d.counts ?? {})).catch(() => {});
  }, []);

  const send = () => {
    if (!valid) return;
    setSent(true);
    setTimeout(() => router.push(onboarded ? "/home" : "/welcome"), 1400);
  };

  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <section className="flex min-h-[45vh] flex-col justify-between gap-8 bg-sand p-6 sm:p-10">
        <Logo size="text-2xl" />
        <div className="w-full max-w-md opacity-80">
          <UsMap counts={counts} supported={SUPPORTED_STATES} base="var(--color-paper)" edge="var(--color-sand)" />
        </div>
        <Headline lead="Find the US importer" tail="made for your wine." className="max-w-md" />
      </section>
      <section className="relative flex flex-col justify-center px-6 py-14 sm:px-12 sm:py-10">
        <span className="caps absolute top-8 right-10">EN · <u>FR</u></span>
        <div className="mx-auto w-full max-w-sm">
          {sent ? (
            <>
              <Headline lead="Check your inbox," tail="it's on its way." />
              <p className="note mt-4">We sent a sign-in link to {email}.</p>
            </>
          ) : (
            <>
              <label htmlFor="email" className="caps">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                className="mt-2 w-full border-b border-taupe bg-transparent py-2 font-serif text-lg outline-none focus:border-wine"
              />
              {!valid && email && <p className="note mt-2">That email looks incomplete.</p>}
              <button className="btn mt-6 w-full" onClick={send} disabled={!valid}>
                Email me a sign-in link
              </button>
              <button className="link mt-5 block w-full text-center" onClick={send}>
                Continue with Google
              </button>
              <p className="note mt-8">No password. New here? The same link creates your account.</p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
