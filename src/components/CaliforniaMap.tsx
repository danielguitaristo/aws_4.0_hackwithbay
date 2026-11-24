import type { Lead } from "@/lib/types";

// Simplified California outline, projected as x = (lon + 124.5) * 20, y = (42 - lat) * 24.
const OUTLINE = "M6 0 L90 0 L90 72 L198 168 L196 223 L148 228 L146 223 L122 197 L106 190 L80 180 L78 163 L52 130 L40 101 L30 96 L14 62 L2 38 Z";

const CITIES: Record<string, [number, number]> = {
  "san francisco": [-122.42, 37.77], "south san francisco": [-122.41, 37.65], oakland: [-122.27, 37.8], berkeley: [-122.27, 37.87],
  emeryville: [-122.29, 37.83], alameda: [-122.27, 37.77], richmond: [-122.35, 37.94], "san rafael": [-122.53, 37.97],
  sausalito: [-122.49, 37.86], napa: [-122.29, 38.3], sonoma: [-122.46, 38.29], healdsburg: [-122.87, 38.61],
  "santa rosa": [-122.71, 38.44], petaluma: [-122.64, 38.23], sacramento: [-121.49, 38.58], "san jose": [-121.89, 37.34],
  "san mateo": [-122.33, 37.56], burlingame: [-122.35, 37.58], hayward: [-122.08, 37.67], "santa cruz": [-122.03, 36.97],
  monterey: [-121.89, 36.6], fresno: [-119.79, 36.74], "paso robles": [-120.69, 35.63], "san luis obispo": [-120.66, 35.28],
  "santa barbara": [-119.7, 34.42], "los angeles": [-118.24, 34.05], "santa monica": [-118.49, 34.02], "culver city": [-118.4, 34.02],
  pasadena: [-118.14, 34.15], glendale: [-118.26, 34.14], burbank: [-118.31, 34.18], "van nuys": [-118.45, 34.19],
  "long beach": [-118.19, 33.77], benicia: [-122.16, 38.05], "american canyon": [-122.26, 38.17], gardena: [-118.31, 33.89],
  vallejo: [-122.26, 38.1], "walnut creek": [-122.06, 37.91], "san carlos": [-122.26, 37.51], "redwood city": [-122.24, 37.49],
  "palo alto": [-122.14, 37.44], novato: [-122.57, 38.11], "st. helena": [-122.47, 38.51], "saint helena": [-122.47, 38.51],
  "el segundo": [-118.42, 33.92], "costa mesa": [-117.92, 33.64], anaheim: [-117.91, 33.84], carlsbad: [-117.35, 33.16], torrance: [-118.34, 33.84], irvine: [-117.83, 33.68], "san diego": [-117.16, 32.72],
};

export function cityPoint(city: string, i = 0): [number, number] | null {
  const c = CITIES[city.trim().toLowerCase()];
  if (!c) return null;
  // small deterministic jitter so importers in the same city don't overlap
  const j = ((i * 37) % 7) - 3;
  return [(c[0] + 124.5) * 20 + j, (42 - c[1]) * 24 + j * 0.6];
}

export function CaliforniaMap({ leads, selected, onSelect, pulse = false }: { leads: Lead[]; selected?: string; onSelect?: (id: string) => void; pulse?: boolean }) {
  return (
    <svg viewBox="-4 -6 210 240" className="w-full" role="img" aria-label={`Map of California with ${leads.length} importers`}>
      <path d={OUTLINE} className="fill-sand stroke-taupe" strokeWidth={0.7} />
      {leads.map((l, i) => {
        const p = cityPoint(l.city, i);
        if (!p) return null;
        const isSel = l.id === selected;
        const r = isSel ? 7 : l.tier === "A" ? 5 : l.tier === "B" ? 3.5 : 2.5;
        return (
          <circle
            key={l.id}
            cx={p[0]}
            cy={p[1]}
            r={r}
            className={`${isSel ? "fill-wine" : l.tier === "C" ? "fill-taupe" : "fill-wine/40"} ${onSelect ? "cursor-pointer" : ""} ${pulse ? "animate-pulse" : ""}`}
            onClick={() => onSelect?.(l.id)}
          >
            <title>{`${l.name} · ${l.city}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
