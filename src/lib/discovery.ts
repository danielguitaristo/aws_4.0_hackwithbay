// Discovery (owner A): TTB permit lists -> ranked California candidates -> Tavily web pages.
// Server-only. Source files: data/ttb/FRL_Alcohol_{Importer,Wholesaler}_Permit_List.csv
// (https://www.ttb.gov/public-information/foia/list-of-permittees).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { tavily } from "@tavily/core";
import type { Permit } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const TTB_FILES = {
  importer: path.join(DATA_DIR, "ttb", "FRL_Alcohol_Importer_Permit_List.csv"),
  wholesaler: path.join(DATA_DIR, "ttb", "FRL_Alcohol_Wholesaler_Permit_List.csv"),
};
const CACHE_DIR = path.join(DATA_DIR, "cache");

// ---- TTB parsing ------------------------------------------------------------

/** One row of the TTB CSV (real column names). */
interface TtbRow {
  Permit_Number: string;
  Owner_Name: string;
  Operating_Name: string;
  Street: string;
  City: string;
  State: string;
  Prem_Zip: string;
  Prem_County: string;
  Industry_Type: string;
  New_Permit_Flag: string;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") cells.push(cur), (cur = "");
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

function readTtb(file: string): TtbRow[] {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${path.relative(process.cwd(), file)}. Download it from https://www.ttb.gov/public-information/foia/list-of-permittees`);
  }
  const lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()])) as unknown as TtbRow;
  });
}

// ---- Candidate ranking ------------------------------------------------------

export interface Candidate {
  id: string;
  name: string; // operating name if any, else owner name
  ownerName: string;
  city: string;
  county: string;
  address: string;
  permits: Permit[];
  hasImporter: boolean;
  hasWholesaler: boolean;
  newPermit: boolean;
  score: number;
  reasons: string[];
}

const LEGAL_SUFFIX = /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|THE|DBA)\b/g;
export const normName = (s: string) =>
  s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, " ").replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();

// Spirits / beer / sake / grocery names: not a fit for a French wine estate.
const NOT_WINE = /\b(SPIRITS?|BEER|BREW\w*|TEQUILA|MEZCAL|VODKA|WHISK\w*|BOURBON|RUM|GIN|SAKE|SOJU|LIQUOR|DISTILL\w*|CIDER|KOMBUCHA|MARKET|FOODS?|GROCERY|SUPERMARKET|TOBACCO|SMOKE|CANNABIS|HEMP)\b/;
// Obvious national mega-distributors, retailers and big wine groups (ICP negative signal).
const MEGA = /\b(SOUTHERN GLAZER|BREAKTHRU|REPUBLIC NATIONAL|RNDC|YOUNG S MARKET|WINEBOW|GALLO|CONSTELLATION|TREASURY|DIAGEO|PERNOD|BACARDI|BROWN FORMAN|MOET|LVMH|COSTCO|TRADER JOE|SAFEWAY|ALBERTSONS|KROGER|WALMART|WAL MART|SAM S|TARGET|WHOLE FOODS|TOTAL WINE|BEVMO|WINE COM|AMAZON|JACKSON FAMILY|DELICATO|BRONCO|TRINCHERO|FOLEY|VINTUS|DEUTSCH|BANFI|TERLATO|FREIXENET|HENKELL|CASTELLO|SANTA MARGHERITA|MARQUIS PHILIPS|OPICI|SAZERAC|HEAVEN HILL|PROXIMO|CAMPARI|DUCKHORN|VINTAGE WINE ESTATES|WX BRANDS|TRUETT HURST|CRUSH PAD)\b/;
// Wineries holding an import permit: producers, not importers.
const PRODUCER = /\b(WINERY|VINEYARDS?|ESTATES?|CELLARS|RANCH|CHATEAU)\b/;
// Importers specialised in another origin, or food businesses: kept but pushed down.
const OTHER_FOCUS = /\b(ITALIA\w*|ITALIAN|ITALY|FRIULI|TOSCAN\w*|PALERMO|IBERIA\w*|SPAIN|SPANISH|ESPAN\w*|PORTUG\w*|GREEK|GREECE|ARGENT\w*|CHILE\w*|AUSTRAL\w*|JAPAN\w*|KOREA\w*|CHINA|CHINESE|INDIA|MEXIC\w*|ARMENIA\w*|GEORGIA\w*|GOURMET|DELICATESSEN|DELI)\b/;

const NAME_SIGNALS: [RegExp, number, string][] = [
  [/\b(FRENCH|FRANCE|FRANCAIS\w*|GAUL\w*|VINS?|LOIRE|BOURGOGNE|TERROIR|CRU)\b/, 4, "French-sounding name"],
  [/\bSELECTIONS?\b/, 3, '"Selections" in name (typical importer)'],
  [/\bIMPORT\w*\b/, 3, '"Import" in name'],
  [/\b(NATURAL|ORGANIC|GROWER|ARTISAN|PAYSAN|FARM)\w*\b/, 2, "Natural / grower wording"],
  [/\b(MERCHANT|NEGOCIANT|AGENCY|PORTFOLIO|WINE (?:CO|GROUP|DIRECT))\b/, 2, "Wine trade wording"],
  [/\bWINES?\b/, 1, '"Wine" in name'],
];

// ICP metros (Bay Area + Los Angeles), by self-reported premises county.
const METRO_COUNTIES = new Set(["ALAMEDA", "SAN FRANCISCO", "MARIN", "CONTRA COSTA", "SAN MATEO", "SANTA CLARA", "SONOMA", "NAPA", "LOS ANGELES"]);

/**
 * California candidates from the TTB lists. Holders of BOTH a CA importer and a CA
 * wholesaler permit (matched by owner name) rank first; spirits/beer-only names,
 * mega-distributors and wineries are excluded.
 */
export function loadCandidates(limit = 25): Candidate[] {
  const rows = [...readTtb(TTB_FILES.importer), ...readTtb(TTB_FILES.wholesaler)].filter((r) => r.State === "CA");
  const byOwner = new Map<string, TtbRow[]>();
  for (const r of rows) {
    const key = normName(r.Owner_Name);
    if (!key) continue;
    byOwner.set(key, [...(byOwner.get(key) ?? []), r]);
  }

  const out: Candidate[] = [];
  for (const [key, group] of byOwner) {
    const imp = group.filter((r) => r.Industry_Type.startsWith("Importer"));
    if (!imp.length) continue; // must be able to import
    const whs = group.filter((r) => r.Industry_Type.startsWith("Wholesaler"));
    const main = imp[0];
    const names = normName(`${main.Owner_Name} ${main.Operating_Name}`);
    if (NOT_WINE.test(names) && !/\bWINES?\b/.test(names)) continue;
    if (MEGA.test(names) || PRODUCER.test(names)) continue;

    const reasons: string[] = [];
    let score = 0;
    if (whs.length) (score += 5), reasons.push("Holds CA importer + wholesaler permits (importer-distributor)");
    else reasons.push("Holds CA importer permit");
    for (const [re, pts, why] of NAME_SIGNALS) if (re.test(names)) (score += pts), reasons.push(why);
    if (score < 6) continue; // no wine signal at all in the name
    if (OTHER_FOCUS.test(names)) (score -= 4), reasons.push("Name suggests another origin or a food business");
    if (METRO_COUNTIES.has(main.Prem_County.toUpperCase())) (score += 1), reasons.push(`Premises in ${main.Prem_County} county`);
    const newPermit = group.some((r) => r.New_Permit_Flag === "1");
    if (newPermit) (score += 1), reasons.push("New TTB permit");

    out.push({
      id: crypto.createHash("sha1").update(key).digest("hex").slice(0, 10),
      name: titleCase(main.Operating_Name || main.Owner_Name),
      ownerName: main.Owner_Name,
      city: titleCase(main.City),
      county: titleCase(main.Prem_County),
      address: [main.Street, main.City, `CA ${main.Prem_Zip}`].filter(Boolean).join(", "),
      permits: [
        ...imp.map((r): Permit => ({ source: "TTB", number: r.Permit_Number, kind: "importer" })),
        ...whs.map((r): Permit => ({ source: "TTB", number: r.Permit_Number, kind: "wholesaler" })),
      ],
      hasImporter: true,
      hasWholesaler: whs.length > 0,
      newPermit,
      score,
      reasons,
    });
  }
  // Same trade name under several owners (e.g. re-registered company): keep the best one.
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score || b.permits.length - a.permits.length || a.name.localeCompare(b.name))
    .filter((c) => {
      const k = normName(c.name);
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, limit);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Llc|Inc)\b/g, (m) => m.toUpperCase());
}

// ---- Web pages (Tavily), cached on disk ------------------------------------

export interface WebPage {
  candidateId: string;
  url: string;
  title: string;
  text: string; // page text (Tavily raw content, else its snippet)
  ownSite: boolean; // domain looks like the candidate's own website
}

// Directories / social sites: little portfolio text, often wrong company.
const SKIP_DOMAINS = ["facebook.com", "instagram.com", "yelp.com", "bizapedia.com", "opencorporates.com", "zoominfo.com", "dnb.com", "mapquest.com", "ttb.gov", "abc.ca.gov"];
const MAX_PAGE_CHARS = 15000;

/** Search query per candidate (README step 4). */
// Name is quoted + "California" so results are about this company, not lookalikes.
export const searchQuery = (c: Candidate) => `"${c.name.replace(/\s+(LLC|INC)$/i, "")}" California wine importer portfolio`;

const GENERIC = new Set(["WINE", "WINES", "IMPORT", "IMPORTS", "IMPORTERS", "SELECTION", "SELECTIONS", "FINE", "AND", "OF", "DE", "LA", "LE", "THE", "GROUP", "INTERNATIONAL", "MERCHANTS", "TRADERS"]);

/** Name variants used to decide whether a page is really about the candidate. */
function nameKeys(c: Candidate) {
  const names = [c.name, c.ownerName].map(normName).filter((n) => n.length >= 4);
  const compact = names.map((n) => n.replace(/ /g, "").toLowerCase());
  const distinctive = names.flatMap((n) => n.split(" ")).filter((w) => w.length >= 4 && !GENERIC.has(w)).map((w) => w.toLowerCase());
  return { names, compact, distinctive };
}

/** "full": domain spells the whole name (jolivinimports.com); "partial": only its distinctive words. */
function siteMatch(url: string, keys: ReturnType<typeof nameKeys>): "full" | "partial" | false {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").split(".")[0].replace(/-/g, "");
  } catch {
    return false;
  }
  if (keys.compact.some((k) => host.includes(k) || (host.length >= 6 && k.startsWith(host)))) return "full";
  if (host.length >= 5 && keys.distinctive.some((w) => host.includes(w))) return "partial";
  return false;
}

function mentionsName(text: string, keys: ReturnType<typeof nameKeys>) {
  const t = normName(text);
  return keys.names.some((n) => t.includes(n));
}

function cachePath(query: string) {
  return path.join(CACHE_DIR, "tavily", `${crypto.createHash("sha1").update(query).digest("hex").slice(0, 16)}.json`);
}

/**
 * Tavily search + page text for one candidate. Results are cached in data/cache/tavily,
 * so the same query is never paid twice. `paid` is true when Tavily was actually called.
 * With `cacheOnly`, a cache miss returns no pages instead of calling Tavily.
 */
export async function fetchPages(c: Candidate, opts: { cacheOnly?: boolean } = {}): Promise<{ pages: WebPage[]; paid: boolean }> {
  const query = searchQuery(c);
  const file = cachePath(query);
  let results: { url: string; title: string; content: string; rawContent?: string }[];
  let paid = false;

  if (fs.existsSync(file)) {
    results = JSON.parse(fs.readFileSync(file, "utf8")).results;
  } else if (opts.cacheOnly || !process.env.TAVILY_API_KEY) {
    return { pages: [], paid: false };
  } else {
    const res = await tavily({ apiKey: process.env.TAVILY_API_KEY }).search(query, {
      searchDepth: "basic",
      maxResults: 6,
      includeRawContent: "text",
      excludeDomains: SKIP_DOMAINS,
    });
    results = res.results.map((r) => ({ url: r.url, title: r.title, content: r.content, rawContent: r.rawContent?.slice(0, MAX_PAGE_CHARS) }));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ query, candidate: c.name, fetchedAt: new Date().toISOString(), results }, null, 1));
    paid = true;
  }

  // Keep only pages on the company's own site or that name it, so no claim is borrowed from another importer.
  const keys = nameKeys(c);
  const pages = results
    .map((r) => {
      const text = (r.rawContent || r.content || "").trim();
      const named = mentionsName(`${r.title} ${text}`, keys);
      const local = new RegExp(`\\b(${c.city}|California)\\b`, "i").test(text);
      // Own site: domain spells the name and the page names it or its city; a partial domain match
      // must name the company in full (so grandcruselections.com is not "Grand Cru Imports").
      const match = siteMatch(r.url, keys);
      const ownSite = match === "full" ? named || local : match === "partial" && named;
      return { candidateId: c.id, url: r.url, title: r.title, text, ownSite, keep: ownSite || (named && local) };
    })
    .filter((p) => p.text.length > 0 && p.keep)
    .map(({ keep, ...p }) => (void keep, p));
  return { pages, paid };
}
