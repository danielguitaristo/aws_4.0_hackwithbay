// City coordinates per state (for map dots) and California zones. Owner: C.
// Keyed by state so homonyms (Portland OR / ME, Richmond CA / VA) don't collide.

const CITIES: Record<string, Record<string, [number, number]>> = {
  CA: {
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
    "el segundo": [-118.42, 33.92], "costa mesa": [-117.92, 33.64], anaheim: [-117.91, 33.84], carlsbad: [-117.35, 33.16],
    torrance: [-118.34, 33.84], irvine: [-117.83, 33.68], "san diego": [-117.16, 32.72], "sherman oaks": [-118.45, 34.15],
  },
  NY: {
    "new york": [-74.0, 40.71], brooklyn: [-73.95, 40.65], bronx: [-73.87, 40.84], queens: [-73.79, 40.73], "long island city": [-73.95, 40.75],
    "white plains": [-73.76, 41.03], "new rochelle": [-73.78, 40.91], yonkers: [-73.9, 40.93], "mount vernon": [-73.84, 40.91],
    "staten island": [-74.15, 40.58], hauppauge: [-73.2, 40.82], rochester: [-77.61, 43.16], buffalo: [-78.88, 42.89], albany: [-73.76, 42.65],
    "port washington": [-73.7, 40.83], syosset: [-73.5, 40.83], elmsford: [-73.82, 41.05], hudson: [-73.79, 42.25],
  },
  FL: {
    miami: [-80.19, 25.76], doral: [-80.36, 25.82], "miami beach": [-80.13, 25.79], "fort lauderdale": [-80.14, 26.12], "boca raton": [-80.08, 26.37],
    "west palm beach": [-80.05, 26.71], orlando: [-81.38, 28.54], tampa: [-82.46, 27.95], jacksonville: [-81.66, 30.33], naples: [-81.79, 26.14],
    "coral gables": [-80.27, 25.72], hialeah: [-80.28, 25.86], "pompano beach": [-80.12, 26.24], sarasota: [-82.53, 27.34],
  },
  TX: {
    austin: [-97.74, 30.27], houston: [-95.37, 29.76], dallas: [-96.8, 32.78], "san antonio": [-98.49, 29.42], irving: [-96.95, 32.81],
    "the woodlands": [-95.49, 30.17], "tthe woodlands": [-95.49, 30.17], lockhart: [-97.67, 29.88], "fort worth": [-97.33, 32.76],
    plano: [-96.7, 33.02], carrollton: [-96.89, 32.95], "el paso": [-106.44, 31.76], addison: [-96.83, 32.96], frisco: [-96.82, 33.15],
  },
  IL: {
    chicago: [-87.63, 41.88], evanston: [-87.69, 42.05], "elk grove village": [-87.97, 42.0], schaumburg: [-88.08, 42.03],
    northbrook: [-87.83, 42.13], skokie: [-87.73, 42.03], "des plaines": [-87.88, 42.03], naperville: [-88.15, 41.79], "oak brook": [-87.95, 41.83],
  },
  NJ: {
    newark: [-74.17, 40.74], "jersey city": [-74.08, 40.73], hoboken: [-74.03, 40.74], secaucus: [-74.06, 40.79], edison: [-74.41, 40.52],
    fairfield: [-74.3, 40.88], carlstadt: [-74.09, 40.84], "east rutherford": [-74.1, 40.83], kearny: [-74.15, 40.77], "north bergen": [-74.01, 40.8],
    paterson: [-74.17, 40.92], "cherry hill": [-75.03, 39.93], princeton: [-74.66, 40.36],
  },
  WA: {
    seattle: [-122.33, 47.61], tacoma: [-122.44, 47.25], kent: [-122.23, 47.38], bellevue: [-122.2, 47.61], spokane: [-117.43, 47.66],
    woodinville: [-122.16, 47.75], redmond: [-122.12, 47.67], everett: [-122.2, 47.98], tukwila: [-122.26, 47.47], vancouver: [-122.66, 45.64],
  },
  OR: {
    portland: [-122.68, 45.52], beaverton: [-122.8, 45.49], salem: [-123.04, 44.94], eugene: [-123.09, 44.05], bend: [-121.31, 44.06],
    tigard: [-122.77, 45.43], "lake oswego": [-122.67, 45.42], hillsboro: [-122.99, 45.52], mcminnville: [-123.2, 45.21], newberg: [-122.97, 45.3],
  },
  MA: {
    boston: [-71.06, 42.36], cambridge: [-71.11, 42.37], somerville: [-71.1, 42.39], woburn: [-71.15, 42.48], worcester: [-71.8, 42.26],
    canton: [-71.14, 42.16], newton: [-71.21, 42.34], brookline: [-71.12, 42.33], springfield: [-72.59, 42.1], "chelsea": [-71.03, 42.39],
  },
};

/** [lon, lat] of a city in a state, or null when we don't know it (the importer stays in the list, without a dot). */
export function cityCoord(state: string, city: string): [number, number] | null {
  return CITIES[state]?.[city.trim().toLowerCase()] ?? null;
}

/** California first: the zones Claire can target inside the state. */
export const METROS = ["San Francisco Bay Area", "Los Angeles", "San Diego", "Central Coast", "Sacramento"] as const;
export type Metro = (typeof METROS)[number];

/** Maps free text from the ICP ("SF Bay Area", "Greater Los Angeles"…) to one of our zones. */
export function normalizeMetro(text: string): Metro | null {
  const t = text.toLowerCase();
  if (/bay area|san francisco|oakland|napa|sonoma|san jose/.test(t)) return "San Francisco Bay Area";
  if (/los angeles|\bla\b|orange county/.test(t)) return "Los Angeles";
  if (/san diego/.test(t)) return "San Diego";
  if (/central coast|monterey|santa barbara|paso robles/.test(t)) return "Central Coast";
  if (/sacramento/.test(t)) return "Sacramento";
  return null;
}

/** Which California zone an importer's city falls in (null when unknown or elsewhere). */
export function metroOf(city: string): Metro | null {
  const c = cityCoord("CA", city);
  if (!c) return null;
  const [lon, lat] = c;
  if (lat >= 37.2 && lat <= 38.8 && lon < -121.7) return "San Francisco Bay Area";
  if (lat >= 38.3 && lat <= 39 && lon >= -121.7) return "Sacramento";
  if (lat < 33.4) return "San Diego";
  if (lat >= 33.5 && lat <= 34.4 && lon > -118.8) return "Los Angeles";
  if (lat >= 34.3 && lat < 37.2) return "Central Coast";
  return null;
}

/** States the search supports today (same list as REGIONS in lib/discovery.ts). */
export const SUPPORTED_STATES = ["CA", "NY", "FL", "TX", "IL", "NJ", "WA", "OR", "MA"];
const STATE_WORDS: [RegExp, string][] = [
  [/california/i, "CA"], [/new york/i, "NY"], [/florida/i, "FL"], [/texas/i, "TX"], [/illinois|chicago/i, "IL"],
  [/new jersey/i, "NJ"], [/washington|seattle/i, "WA"], [/oregon|portland/i, "OR"], [/massachusetts|boston/i, "MA"],
];
/** The supported state a segment talks about ("New York natural-wine importers" -> "NY"), if any. */
export function stateInText(text: string): string | null {
  return STATE_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
}
