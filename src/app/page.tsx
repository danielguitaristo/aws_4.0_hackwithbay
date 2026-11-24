import { DEMO_DOMAINE, MOCK_LEADS } from "@/lib/demo";

// Placeholder home. Owner: C (replace with intake / leads / review / pipeline views).
export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">WineGTM</h1>
      <p className="mt-2 text-neutral-600">{DEMO_DOMAINE.name} · {MOCK_LEADS.length} mock leads loaded</p>
    </main>
  );
}
