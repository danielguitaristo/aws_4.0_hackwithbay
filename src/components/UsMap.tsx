"use client";
// Real US state shapes (us-atlas + d3-geo): the national map on the Target step,
// and a single-state map with importer dots on the Importers step.
import { geoAlbersUsa, geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import usAtlas from "us-atlas/states-10m.json";
import type { Lead } from "@/lib/types";
import { cityCoord } from "@/lib/places";

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const CODE_BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([c, n]) => [n, c]));

type StateFeature = Feature<Geometry, { name: string }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STATES = (feature(usAtlas as any, (usAtlas as any).objects.states) as unknown as FeatureCollection<Geometry, { name: string }>).features as StateFeature[];
const codeOf = (f: StateFeature) => CODE_BY_NAME[f.properties.name];

const W = 960;
const H = 600;
const usPath = geoPath(geoAlbersUsa().scale(1280).translate([W / 2, H / 2]));

/** National map: states shaded by licensed importers; supported states are clickable, the selected one is burgundy. */
/** Without onSelect the map is decorative (sign-in page). */
export function UsMap({ counts, supported, selected, onSelect, base = "var(--color-sand)", edge = "var(--color-cream)" }: { counts: Record<string, number>; supported: string[]; selected?: string; onSelect?: (code: string) => void; base?: string; edge?: string }) {
  const max = Math.max(1, ...supported.map((c) => counts[c] ?? 0));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Map of the United States by number of licensed wine importers">
      {STATES.map((f) => {
        const code = codeOf(f);
        const d = usPath(f) ?? undefined;
        if (!d || !code) return null;
        const on = supported.includes(code);
        const clickable = on && !!onSelect;
        const share = (counts[code] ?? 0) / max;
        const fill = code === selected ? "var(--color-wine)" : on ? `color-mix(in srgb, var(--color-taupe) ${Math.round(25 + share * 55)}%, var(--color-cream))` : base;
        return (
          <path
            key={f.id ?? code}
            d={d}
            fill={fill}
            stroke={edge}
            strokeWidth={1}
            className={clickable ? "cursor-pointer transition-opacity hover:opacity-80" : ""}
            onClick={clickable ? () => onSelect(code) : undefined}
          >
            <title>{`${STATE_NAMES[code]} · ${(counts[code] ?? 0).toLocaleString("en-US")} licensed importers${on ? "" : " · coming next"}`}</title>
          </path>
        );
      })}
    </svg>
  );
}

/** One state, fitted to the box, with importer dots (size = tier; burgundy = selected). */
export function StateMap({ state, leads, selected, onSelect, pulse = false }: { state: string; leads: Lead[]; selected?: string; onSelect?: (id: string) => void; pulse?: boolean }) {
  const f = STATES.find((x) => codeOf(x) === state);
  if (!f) return null;
  const projection = geoMercator().fitExtent([[6, 6], [204, 234]], f);
  const d = geoPath(projection)(f) ?? undefined;
  return (
    <svg viewBox="0 0 210 240" className="w-full" role="img" aria-label={`Map of ${STATE_NAMES[state]} with ${leads.length} importers`}>
      <path d={d} className="fill-sand stroke-taupe" strokeWidth={0.7} />
      {leads.map((l, i) => {
        const c = cityCoord(state, l.city);
        const p = c && projection([c[0] + ((i * 37) % 7 - 3) * 0.01, c[1]]);
        if (!p) return null;
        const isSel = l.id === selected;
        const r = isSel ? 7 : l.tier === "A" ? 5 : l.tier === "B" ? 3.5 : 2.5;
        return (
          <circle key={l.id} cx={p[0]} cy={p[1]} r={r} onClick={() => onSelect?.(l.id)}
            className={`${isSel ? "fill-wine" : l.tier === "C" ? "fill-taupe" : "fill-wine/40"} ${onSelect ? "cursor-pointer" : ""} ${pulse ? "animate-pulse" : ""}`}>
            <title>{`${l.name} · ${l.city}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
