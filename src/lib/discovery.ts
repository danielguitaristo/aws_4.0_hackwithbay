// Discovery (owner A): TTB permit lists -> ranked California candidates -> Tavily web pages.
// Server-only. Source files: data/ttb/FRL_Alcohol_{Importer,Wholesaler}_Permit_List.csv
// (https://www.ttb.gov/public-information/foia/list-of-permittees).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { tavily } from "@tavily/core";
import type { ICP, Lead, Permit, Source } from "./types";
import { asNumber, asObject, asString, cacheKey, chatJSON, hasMistral, readCache, writeCache } from "./llm";
import { SIGNALS, WEB_SIGNALS, scoreHits, signalPoints, signalQueries, type SignalHit } from "./signals";
import { buildIndex, type PageIndex, type Snippet } from "./retrieval";

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
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cur);
      cur = "";
    }
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

const GENERIC_TOKENS = new Set(["WINE", "WINES", "IMPORT", "IMPORTS", "IMPORTER", "IMPORTERS", "IMPORTING", "SELECTION", "SELECTIONS", "MERCHANT", "MERCHANTS", "FINE", "AND", "OF", "DE", "DU", "DES", "LA", "LE", "LES", "THE", "GROUP", "INTERNATIONAL", "TRADERS", "TRADING", "DISTRIBUTION", "DISTRIBUTORS", "DISTRIBUTING", "COLLECTION", "PORTFOLIO", "USA", "AMERICA", "AMERICAN", "CALIFORNIA", "ENTERPRISES", "HOLDINGS", "VENTURES", "BRANDS", "BEVERAGE", "BEVERAGES", "AGENCY", "PARTNERS", "ASSOCIATES", "SPIRITS"]);

/** Name words that identify a company (drops legal suffixes and wine-trade filler). */
export const distinctiveTokens = (s: string) => normName(s).split(" ").filter((w) => w.length >= 3 && !GENERIC_TOKENS.has(w));

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

interface Company extends Candidate {
  nameScore: number; // name-only score used for the TTB-first ranking
  producer: boolean; // looks like a winery
  tokens: Set<string>; // distinctive name tokens (operating + owner)
}

let companiesMemo: Company[] | null = null;
const cityCounty = new Map<string, string>(); // CA city -> premises county, learned from the TTB rows

// Metros for fuzzy city matching (a page saying "Los Angeles" for a Sherman Oaks permit).
const METROS: Record<string, string> = {
  ALAMEDA: "BAY", "SAN FRANCISCO": "BAY", MARIN: "BAY", "CONTRA COSTA": "BAY", "SAN MATEO": "BAY", "SANTA CLARA": "BAY", SONOMA: "BAY", NAPA: "BAY", SOLANO: "BAY",
  "LOS ANGELES": "LA", ORANGE: "LA", VENTURA: "LA",
};

/** Same city, or both cities in the same county / metro. */
function sameArea(cityA: string, cityB: string): boolean {
  const a = normName(cityA), b = normName(cityB);
  if (a === b) return true;
  const ca = cityCounty.get(a), cb = cityCounty.get(b);
  return Boolean(ca && cb && (ca === cb || (METROS[ca] && METROS[ca] === METROS[cb])));
}

/** Every California importer-permit holder (grouped by owner), minus spirits/beer-only and mega-distributors. */
function allCompanies(): Company[] {
  if (companiesMemo) return companiesMemo;
  const rows = [...readTtb(TTB_FILES.importer), ...readTtb(TTB_FILES.wholesaler)].filter((r) => r.State === "CA");
  for (const r of rows) if (r.City && r.Prem_County && !cityCounty.has(normName(r.City))) cityCounty.set(normName(r.City), r.Prem_County.toUpperCase());
  const byOwner = new Map<string, TtbRow[]>();
  for (const r of rows) {
    const key = normName(r.Owner_Name);
    if (!key) continue;
    byOwner.set(key, [...(byOwner.get(key) ?? []), r]);
  }

  const out: Company[] = [];
  for (const [key, group] of byOwner) {
    const imp = group.filter((r) => r.Industry_Type.startsWith("Importer"));
    if (!imp.length) continue; // must be able to import
    const whs = group.filter((r) => r.Industry_Type.startsWith("Wholesaler"));
    const main = imp[0];
    const names = normName(`${main.Owner_Name} ${main.Operating_Name}`);
    if (NOT_WINE.test(names) && !/\bWINES?\b/.test(names)) continue;
    if (MEGA.test(names)) continue;

    const reasons: string[] = [];
    let score = 0;
    const add = (pts: number, why: string) => {
      score += pts;
      reasons.push(why);
    };
    if (whs.length) add(5, "Holds CA importer + wholesaler permits (importer-distributor)");
    else reasons.push("Holds CA importer permit");
    for (const [re, pts, why] of NAME_SIGNALS) if (re.test(names)) add(pts, why);
    const nameScore = score;
    if (OTHER_FOCUS.test(names)) add(-4, "Name suggests another origin or a food business");
    if (METRO_COUNTIES.has(main.Prem_County.toUpperCase())) add(1, `Premises in ${main.Prem_County} county`);
    const newPermit = group.some((r) => r.New_Permit_Flag === "1");
    if (newPermit) add(1, "New TTB permit");

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
      nameScore,
      producer: PRODUCER.test(names),
      tokens: new Set(group.flatMap((r) => distinctiveTokens(`${r.Owner_Name} ${r.Operating_Name}`))),
    });
  }
  companiesMemo = out;
  return out;
}

const strip = ({ nameScore, producer, tokens, ...c }: Company): Candidate => (void nameScore, void producer, void tokens, c);

/**
 * California candidates from the TTB lists. Holders of BOTH a CA importer and a CA
 * wholesaler permit (matched by owner name) rank first; spirits/beer-only names,
 * mega-distributors and wineries are excluded.
 */
export function loadCandidates(limit = 25): Candidate[] {
  // Same trade name under several owners (e.g. re-registered company): keep the best one.
  const seen = new Set<string>();
  return allCompanies()
    .filter((c) => !c.producer && c.nameScore >= 6) // no wine signal at all in the name -> skip
    .sort((a, b) => b.score - a.score || b.permits.length - a.permits.length || a.name.localeCompare(b.name))
    .filter((c) => {
      const k = normName(c.name);
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, limit)
    .map(strip);
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

/** Counts Tavily calls actually paid (cache misses) during one discovery run. */
export interface Usage {
  searches: number;
}

interface RawResult {
  url: string;
  title: string;
  content: string;
  rawContent?: string;
}

// Directories / social sites: little portfolio text, often wrong company.
const SKIP_DOMAINS = ["facebook.com", "instagram.com", "yelp.com", "bizapedia.com", "opencorporates.com", "zoominfo.com", "dnb.com", "mapquest.com", "ttb.gov", "abc.ca.gov"];
const MAX_PAGE_CHARS = 15000;

function tavilyClient() {
  if (!process.env.TAVILY_API_KEY) throw new Error("TAVILY_API_KEY is not set");
  return tavily({ apiKey: process.env.TAVILY_API_KEY });
}

function cacheFile(key: string) {
  return path.join(CACHE_DIR, "tavily", `${crypto.createHash("sha1").update(key).digest("hex").slice(0, 16)}.json`);
}

/**
 * Runs a Tavily call once and caches it in data/cache/tavily (keyed by the query or call),
 * so the same search is never paid twice. Returns null on a cache miss when Tavily is unavailable.
 */
async function cachedTavily<T>(key: string, u: Usage, run: () => Promise<T>, meta: Record<string, unknown> = {}): Promise<T | null> {
  const file = cacheFile(key);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")).results as T;
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const results = await run();
    u.searches++;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ query: key, ...meta, fetchedAt: new Date().toISOString(), results }, null, 1));
    } catch (err) {
      console.warn(`[tavily] cache write skipped: ${String(err)}`);
    }
    return results;
  } catch (err) {
    console.error(`[tavily] ${key} failed:`, err);
    return null;
  }
}

/** Tavily search with raw page text (basic depth = 1 credit). */
function search(query: string, u: Usage, opts: { maxResults?: number; exact?: boolean; includeDomains?: string[] } = {}, meta = {}) {
  // Base candidate queries keep their original cache key (the bare query string).
  const key = opts.exact || opts.includeDomains ? `search:${query}:${JSON.stringify(opts)}` : query;
  return cachedTavily<RawResult[]>(
    key,
    u,
    async () => {
      const res = await tavilyClient().search(query, {
        searchDepth: "basic",
        maxResults: opts.maxResults ?? 6,
        includeRawContent: "text",
        excludeDomains: SKIP_DOMAINS,
        ...(opts.exact ? { exactMatch: true, country: "united states" } : {}),
        ...(opts.includeDomains ? { includeDomains: opts.includeDomains } : {}),
      });
      return res.results.map((r) => ({ url: r.url, title: r.title, content: r.content, rawContent: r.rawContent?.slice(0, MAX_PAGE_CHARS) }));
    },
    meta,
  );
}

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
    host = new URL(url).hostname.replace(/^www\./, "").split(".").slice(-2)[0].replace(/-/g, ""); // shop.kermitlynch.com -> kermitlynch
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

// A third-party page must use the name as an importer/distributor, not as a winery or a passing mention.
const IMPORTER_CONTEXT = /\b(IMPORT\w*|DISTRIBUT\w*|WHOLESAL\w*|PORTFOLIO|SELECTIONS?|MERCHANT|NEGOCIANT)\b/;
// Titles of pages that belong to another wine company (its own portfolio / about page).
const OTHER_COMPANY_TITLE = /\b(imports|selections|wine company|portfolio|about us)\b/i;

/** Pages dropped by relevantPages(), with the reason (for audits). */
export const rejectedPages: { candidate: string; url: string; reason: string }[] = [];

function pageVerdict(c: Candidate, keys: ReturnType<typeof nameKeys>, r: RawResult, text: string, forceOwn: boolean): { ownSite: boolean; reason?: string } {
  const named = mentionsName(`${r.title} ${text}`, keys);
  const local = new RegExp(`\\b(${c.city}|California)\\b`, "i").test(text);
  const t = normName(text);

  // Own site: domain spells the name and the page names it or its city; a partial domain match
  // must name the company in full (so grandcruselections.com is not "Grand Cru Imports").
  const match = siteMatch(r.url, keys);
  if (forceOwn || (match === "full" ? named || local : match === "partial" && named)) return { ownSite: true };

  if (!(named && local)) return { ownSite: false, reason: "does not name the company with California/its city" };
  // Homonym: "CRU Winery" is a producer, not the importer Cru Wines LLC.
  const core = distinctiveTokens(c.name).join(" ");
  if (core && new RegExp(`\\b${core} (WINERY|VINEYARDS?|ESTATES?|CELLARS)\\b`).test(t)) return { ownSite: false, reason: `"${core}" refers to a winery/producer` };
  const host = (() => { try { return new URL(r.url).hostname; } catch { return ""; } })();
  if (host.endsWith("linkedin.com") && !mentionsName(r.title, keys)) return { ownSite: false, reason: "LinkedIn profile of someone at another company" };
  if (OTHER_COMPANY_TITLE.test(r.title) && !mentionsName(r.title, keys) && !/importers|distributors/i.test(r.title)) return { ownSite: false, reason: "page belongs to another wine company" };
  const nearImporter = keys.names.some((n) => {
    for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) if (IMPORTER_CONTEXT.test(t.slice(Math.max(0, i - 300), i + n.length + 300))) return true;
    return false;
  });
  if (!nearImporter && !host.endsWith("linkedin.com")) return { ownSite: false, reason: "name not used as an importer/distributor" };
  return { ownSite: false };
}

/** Keep only pages on the company's own site or that name it as an importer, so no claim is borrowed from another company. */
function relevantPages(c: Candidate, results: RawResult[], forceOwn = false): WebPage[] {
  const keys = nameKeys(c);
  const out: WebPage[] = [];
  for (const r of results) {
    const text = (r.rawContent || r.content || "").trim();
    if (!text) continue;
    const v = pageVerdict(c, keys, r, text, forceOwn);
    if (v.reason) {
      if (!rejectedPages.some((x) => x.candidate === c.name && x.url === r.url)) rejectedPages.push({ candidate: c.name, url: r.url, reason: v.reason });
      continue;
    }
    out.push({ candidateId: c.id, url: r.url, title: r.title, text, ownSite: v.ownSite });
  }
  return out;
}

/** Base search for one candidate (README step 4). `paid` is true when Tavily was actually called. */
export async function fetchPages(c: Candidate, opts: { cacheOnly?: boolean } = {}): Promise<{ pages: WebPage[]; paid: boolean }> {
  const u: Usage = { searches: 0 };
  const results = opts.cacheOnly && !fs.existsSync(cacheFile(searchQuery(c))) ? [] : ((await search(searchQuery(c), u, {}, { candidate: c.name })) ?? []);
  return { pages: relevantPages(c, results), paid: u.searches > 0 };
}

// Producer / portfolio pages on an importer's own site: index pages first, then producer pages.
const PORTFOLIO_INDEX = /(producers?|growers?|portfolio|our-wines|winemakers|vignerons|region|by-region|loire|france|french|domaines)/i;
const PORTFOLIO_PATH = /(producer|portfolio|grower|winemaker|vigneron|domaine|chateau|estate|france|french|loire|our-wines|wines|brands|book)/i;

const baseDomain = (host: string) => host.replace(/^www\./, "").split(".").slice(-2).join(".");

/**
 * Best-practice two-step on the importer's own site: map() to list URLs, then extract()
 * the producer/portfolio pages (full producer lists are needed to build the structured portfolio).
 */
async function ownSitePages(c: Candidate, origin: string, u: Usage): Promise<WebPage[]> {
  const domain = baseDomain(new URL(origin).hostname);
  const urls = await cachedTavily<string[]>(`map:${origin}`, u, async () => (await tavilyClient().map(origin, { maxDepth: 2, limit: 60 })).results, { candidate: c.name });
  const sameSite = (urls ?? []).filter((x) => {
    try {
      return baseDomain(new URL(x).hostname) === domain; // map can return external links (e.g. another importer's producer pages)
    } catch {
      return false;
    }
  });
  const rank = (x: string) => (PORTFOLIO_INDEX.test(new URL(x).pathname) ? 2 : PORTFOLIO_PATH.test(new URL(x).pathname) ? 1 : 0);
  const picks = [...new Set(sameSite)].filter((x) => rank(x) > 0).sort((a, b) => rank(b) - rank(a)).slice(0, 10);
  if (!picks.length) return [];
  const extracted = await cachedTavily<RawResult[]>(
    `extract:${picks.join(",")}`,
    u,
    async () =>
      (await tavilyClient().extract(picks, { extractDepth: "basic", format: "text" })).results.map((r) => ({
        url: r.url,
        title: r.title ?? "",
        content: "",
        rawContent: r.rawContent.slice(0, MAX_PAGE_CHARS),
      })),
    { candidate: c.name },
  );
  return relevantPages(c, extracted ?? [], true);
}

/**
 * All evidence pages for a candidate: base search, one search per distinct signal query
 * (exact name match, US), and the producer pages of its own website. Deduped by URL.
 */
export async function enrichPages(c: Candidate, u: Usage, seed: WebPage[] = []): Promise<WebPage[]> {
  const base = await search(searchQuery(c), u, {}, { candidate: c.name });
  const perSignal = await Promise.all(signalQueries(c.name).map((q) => search(q, u, { exact: true, maxResults: 5 }, { candidate: c.name })));
  let pages = [...seed, ...relevantPages(c, [...(base ?? []), ...perSignal.flat().filter((r): r is RawResult => Boolean(r))])];

  const own = pages.find((p) => p.ownSite);
  if (own) pages = [...pages, ...(await ownSitePages(c, new URL(own.url).origin, u))];

  const byUrl = new Map<string, WebPage>();
  for (const p of pages) if (!byUrl.has(p.url) || p.text.length > byUrl.get(p.url)!.text.length) byUrl.set(p.url, p);
  return [...byUrl.values()];
}

// ---- Reverse search: topic queries -> company names -> TTB permit match -----

export const TOPIC_QUERIES = [
  "California importer Loire natural growers",
  "Bay Area importer organic French small growers",
  "Los Angeles natural wine importer Chenin Blanc",
  "San Francisco wine importer Loire Valley grower portfolio",
  "California importer distributor French organic biodynamic small producers",
  "Oakland Berkeley natural wine importer France Jura Loire",
  "California importer small French growers Loire Beaujolais Champagne portfolio",
  "Sonoma Napa importer French family estates organic",
  "San Diego Orange County wine importer French natural producers",
  "California wine importer distributor Muscadet Saumur Anjou producers",
];

interface Mention {
  name: string;
  city: string;
  result: number;
}

function validateMentions(raw: unknown): Mention[] {
  const list = asObject(raw, "root").companies;
  if (!Array.isArray(list)) throw new Error("companies must be an array");
  return list.map((m, i) => {
    const o = asObject(m, `companies[${i}]`);
    return { name: asString(o.name, "name"), city: typeof o.city === "string" ? o.city : "", result: asNumber(o.result, "result", 0, 99) };
  });
}

const MENTION_PROMPT = `You read web search results about wine importers.
List every wine IMPORTER or importer-distributor company named in the results that appears to be based in California.
Copy each company name exactly as written in the text. Include its California city only if the text states it.
Do not add companies that are not named in the text. Ignore wineries, shops and restaurants.
Return JSON: {"companies":[{"name":"...","city":"...","result":<result number>}]}`;

let tokenFreq: Map<string, number> | null = null;
/** A word used by at most 2 CA importers (e.g. "BAIRE") identifies a company on its own. */
function rareToken(w: string): boolean {
  if (!tokenFreq) {
    tokenFreq = new Map();
    for (const c of allCompanies()) for (const t of c.tokens) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
  }
  return w.length >= 5 && (tokenFreq.get(w) ?? 0) <= 2;
}

/**
 * Fuzzy match of a web-mentioned name to a TTB CA importer: all distinctive words of the
 * mention must be in the permit name (owner or trade name), and the city must match
 * (stated city in the same city/county/metro, or the TTB city appearing in the page text).
 */
function matchCompany(name: string, city: string, pageText: string): Company | null {
  const want = distinctiveTokens(name);
  if (!want.length) return null;
  // One distinctive word ("The Source Imports") is too weak: require the whole name to match.
  const fullName = normName(name).replace(/^THE /, "");
  let best: { c: Company; score: number } | null = null;
  for (const c of allCompanies()) {
    if (!want.every((w) => c.tokens.has(w))) continue;
    if (want.length === 1 && !rareToken(want[0]) && ![c.name, c.ownerName].some((n) => normName(n).replace(/^THE /, "") === fullName)) continue;
    const cityOk = city ? sameArea(city, c.city) : new RegExp(`\\b${c.city}\\b`, "i").test(pageText);
    if (!cityOk) continue;
    const score = want.length / c.tokens.size; // 1 = same distinctive words
    if (score >= 0.5 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c ?? null;
}

/** Topic searches -> Mistral lists the importers named -> keep only those holding a CA TTB importer permit. */
export async function reverseSearch(u: Usage): Promise<{ candidate: Candidate; pages: WebPage[] }[]> {
  const found = new Map<string, { candidate: Candidate; pages: WebPage[] }>();
  await Promise.all(
    TOPIC_QUERIES.map(async (q) => {
      const results = (await search(q, u, { maxResults: 10 }, { topic: true })) ?? [];
      if (!results.length || !hasMistral()) return;
      const key = cacheKey({ q, urls: results.map((r) => r.url) });
      let mentions = readCache<Mention[]>("mentions", key);
      if (!mentions) {
        const listing = results.map((r, i) => `[${i}] ${r.title} (${r.url})\n${(r.rawContent || r.content).slice(0, 4000)}`).join("\n\n");
        mentions = await chatJSON([{ role: "system", content: MENTION_PROMPT }, { role: "user", content: listing }], validateMentions).catch((err) => {
          console.error(`[reverseSearch] Mistral failed for "${q}":`, err);
          return null;
        });
        if (!mentions) return;
        writeCache("mentions", key, mentions);
      }
      const textOf = (r: RawResult) => `${r.title} ${r.rawContent || r.content}`;
      for (const m of mentions) {
        // The name must really be in a page; Mistral's result number is only a hint.
        const has = (r?: RawResult) => Boolean(r && normName(textOf(r)).includes(normName(m.name)));
        const r = has(results[m.result]) ? results[m.result] : results.find(has);
        if (!r) continue;
        const text = textOf(r);
        const company = matchCompany(m.name, m.city, text);
        if (!company) continue;
        const candidate = { ...strip(company), reasons: [...company.reasons, `Found by web search "${q}" (${r.url})`] };
        const entry = found.get(candidate.id) ?? { candidate, pages: [] };
        entry.pages.push(...relevantPages(candidate, [r]));
        found.set(candidate.id, entry);
      }
    }),
  );
  return [...found.values()];
}

// ---- Candidate pool: TTB-first survivors + reverse-search finds -------------

export interface CandidateEvidence {
  candidate: Candidate;
  pages: WebPage[];
}

/**
 * Top-25 TTB candidates that have at least one relevant page, merged with the companies
 * found by topic searches (deduped by TTB owner), then enriched with per-signal searches.
 */
export async function discoverCandidates(u: Usage, opts: { ttbLimit?: number; concurrency?: number } = {}): Promise<CandidateEvidence[]> {
  const pool = new Map<string, CandidateEvidence>();
  for (const c of loadCandidates(opts.ttbLimit ?? 25)) {
    const base = relevantPages(c, (await search(searchQuery(c), u, {}, { candidate: c.name })) ?? []);
    if (base.length) pool.set(c.id, { candidate: c, pages: base });
  }
  for (const f of await reverseSearch(u)) {
    const prev = pool.get(f.candidate.id);
    if (prev) {
      prev.candidate.reasons.push(...f.candidate.reasons.filter((r) => !prev.candidate.reasons.includes(r)));
      prev.pages.push(...f.pages);
    } else pool.set(f.candidate.id, f);
  }

  const entries = [...pool.values()];
  const out: CandidateEvidence[] = [];
  const limit = opts.concurrency ?? 4;
  for (let i = 0; i < entries.length; i += limit) {
    const batch = entries.slice(i, i + limit);
    out.push(...(await Promise.all(batch.map(async (e) => ({ candidate: e.candidate, pages: await enrichPages(e.candidate, u, e.pages) })))));
  }
  return out.filter((e) => e.pages.length > 0);
}

// ---- Structured portfolio (own website -> producers) ------------------------

export interface PortfolioEntry {
  producer: string;
  country: string;
  region: string;
  appellation: string;
  grapes: string[];
  url: string; // own-site page where the producer is listed
  quote: string; // verbatim text around the producer name on that page (cut by code, not by the LLM)
}

export interface Portfolio {
  candidateId: string;
  website: string;
  pagesRead: string[];
  producers: PortfolioEntry[];
}

const LOIRE = /\b(loire|muscadet|anjou|saumur|savenni[eè]res|bonnezeaux|quarts de chaume|coteaux du layon|chinon|bourgueil|saint-nicolas|touraine|vouvray|montlouis|cheverny|cour-cheverny|sancerre|pouilly-fum[eé]|menetou|quincy|reuilly|jasni[eè]res|coteaux du loir|valen[cç]ay|cr[eé]mant de loire|fiefs vend[eé]ens|orl[eé]ans)\b/i;
const TOURAINE = /\b(touraine|vouvray|montlouis|amboise|azay-le-rideau|chenonceaux|mesland|oisly)\b/i;
const NEIGHBORS = /\b(burgundy|bourgogne|beaujolais|jura|savoie|champagne|alsace|chablis|m[aâ]con)\b/i;

function validatePortfolio(raw: unknown): Omit<PortfolioEntry, "url" | "quote">[] & { page?: number }[] {
  const list = asObject(raw, "root").producers;
  if (!Array.isArray(list)) throw new Error("producers must be an array");
  return list.map((x, i) => {
    const o = asObject(x, `producers[${i}]`);
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      producer: asString(o.producer, "producer"),
      country: str(o.country),
      region: str(o.region),
      appellation: str(o.appellation),
      grapes: Array.isArray(o.grapes) ? o.grapes.filter((g): g is string => typeof g === "string") : [],
      page: asNumber(o.page, "page", 0, 99),
    };
  });
}

const PORTFOLIO_PROMPT = (c: Candidate) => `These numbered pages come from the website of the US wine importer "${c.name}".
List the wine producers (domaines, châteaux, estates, growers) this importer carries.
For each: {"producer": name exactly as written on the page, "country", "region" (wine region, e.g. "Loire", "Burgundy", "Rhône"),
"appellation" (if the page states it, else ""), "grapes" (if stated, else []), "page": page number}.
Only producers named in the pages. Do not include the importer itself, people, shops or restaurants.
Return JSON: {"producers":[...]}`;

const MAX_PORTFOLIO_CHARS = 45000;

/** Mistral reads the importer's own producer/portfolio pages; each producer must appear verbatim on its page. Cached in data/cache/portfolio. */
export async function extractPortfolio(c: Candidate, pages: WebPage[]): Promise<Portfolio | null> {
  const rank = (p: WebPage) => {
    const path = new URL(p.url).pathname;
    return PORTFOLIO_INDEX.test(path) ? 2 : PORTFOLIO_PATH.test(path) ? 1 : 0;
  };
  const own = pages.filter((p) => p.ownSite).sort((a, b) => rank(b) - rank(a));
  if (!own.length) return null;
  const picked: WebPage[] = [];
  let budget = MAX_PORTFOLIO_CHARS;
  for (const p of own) {
    if (budget <= 0) break;
    const text = p.text.slice(0, Math.min(rank(p) === 2 ? 15000 : 6000, budget)); // index pages in full
    picked.push({ ...p, text });
    budget -= text.length;
  }

  const key = cacheKey({ c: c.id, pages: picked.map((p) => [p.url, p.text.length]), model: process.env.MISTRAL_MODEL });
  const cached = readCache<{ key: string; portfolio: Portfolio }>("portfolio", c.id);
  if (cached?.key === key) return cached.portfolio;
  if (!hasMistral()) return null;

  const listing = picked.map((p, i) => `[${i}] ${p.url}\n${p.text}`).join("\n\n");
  const raw = await chatJSON([{ role: "system", content: PORTFOLIO_PROMPT(c) }, { role: "user", content: listing }], validatePortfolio).catch((err) => {
    console.error(`[portfolio] Mistral failed for ${c.name}:`, err);
    return null;
  });
  if (!raw) return null;

  const producers: PortfolioEntry[] = [];
  for (const r of raw as (Omit<PortfolioEntry, "url" | "quote"> & { page: number })[]) {
    // The producer must be on the page Mistral cites, else on any page read; otherwise it is dropped.
    const onPage = (p?: WebPage) => Boolean(p && squash(p.text).includes(squash(r.producer)));
    const page = onPage(picked[r.page]) ? picked[r.page] : picked.find(onPage);
    if (!page || squash(r.producer).length < 3 || producers.some((x) => squash(x.producer) === squash(r.producer))) continue;
    const flat = page.text.replace(/\s+/g, " ");
    const i = flat.toLowerCase().indexOf(r.producer.toLowerCase().replace(/\s+/g, " "));
    const quote = i >= 0 ? flat.slice(Math.max(0, i - 60), i + r.producer.length + 100).trim() : r.producer;
    producers.push({ producer: r.producer.trim(), country: r.country, region: r.region, appellation: r.appellation, grapes: r.grapes, url: page.url, quote });
  }
  const portfolio: Portfolio = { candidateId: c.id, website: new URL(own[0].url).origin, pagesRead: picked.map((p) => p.url), producers };
  writeCache("portfolio", c.id, { key, portfolio });
  return portfolio;
}

const isLoire = (p: PortfolioEntry) => LOIRE.test(`${p.region} ${p.appellation}`);
const isTouraine = (p: PortfolioEntry) => TOURAINE.test(`${p.region} ${p.appellation}`);
const fmt = (p: PortfolioEntry) => `${p.producer}${p.appellation || p.region ? ` (${p.appellation || p.region})` : ""}`;

/** Portfolio signals computed by code from the structured portfolio (never guessed by the LLM). */
function portfolioHits(pf: Portfolio): SignalHit[] {
  const def = (id: string) => SIGNALS.find((s) => s.id === id && s.enabled);
  const hit = (id: string, summary: string, e: PortfolioEntry): SignalHit[] => {
    const d = def(id);
    return d ? [{ id, label: d.label, points: signalPoints(d), snippet: `${summary}. Evidence: "${e.quote}"`, url: e.url }] : [];
  };
  const site = new URL(pf.website).hostname.replace(/^www\./, "");
  const loire = pf.producers.filter(isLoire);
  const touraine = loire.filter(isTouraine);
  const neighbors = pf.producers.filter((p) => NEIGHBORS.test(`${p.region} ${p.appellation}`));
  const out: SignalHit[] = [];
  // Absence of Touraine is only meaningful on a real list (>=10 producers read) that is not already Loire-saturated.
  if (loire.length && loire.length < 10 && !touraine.length && pf.producers.length >= 10)
    out.push(...hit("portfolio_hole", `${loire.length} Loire producer(s) — ${loire.slice(0, 5).map(fmt).join("; ")} — and none from Touraine/Vouvray among ${pf.producers.length} producers read on ${site}`, loire[0]));
  if (loire.length >= 10) out.push(...hit("loire_saturated", `${loire.length} Loire producers listed on ${site}`, loire[0]));
  if (touraine.length) out.push(...hit("similar_chenin", `Already carries Touraine/Vouvray: ${touraine.map(fmt).join("; ")}`, touraine[0]));
  if (neighbors.length) out.push(...hit("neighbor_regions", `${neighbors.length} producer(s) from neighboring regions — ${neighbors.slice(0, 4).map(fmt).join("; ")}`, neighbors[0]));
  return out;
}

// ---- Scoring: Mistral reads ONLY retrieved snippets, code verifies every quote ----

/** Lead + extras for the UI: score breakdown and structured portfolio (not yet in types.ts). */
export type ScoredLead = Lead & { scoreBreakdown: SignalHit[]; portfolioDetail: PortfolioEntry[] };

const TTB_LIST_URL = "https://www.ttb.gov/public-information/foia/list-of-permittees";

interface Judgement {
  signals: { id: string; fired: boolean; snippet: number; quote: string }[];
}

function validateJudgement(raw: unknown): Judgement {
  const o = asObject(raw, "root");
  if (!Array.isArray(o.signals)) throw new Error("signals must be an array");
  return {
    signals: o.signals.map((x, i) => {
      const s = asObject(x, `signals[${i}]`);
      return { id: asString(s.id, "id"), fired: s.fired === true, snippet: s.fired === true ? asNumber(s.snippet, "snippet") : -1, quote: typeof s.quote === "string" ? s.quote : "" };
    }),
  };
}

const JUDGE_PROMPT = (c: Candidate, icp: ICP) => `You check whether a California wine importer fits a small organic Loire estate (Touraine/Vouvray/Chinon: Chenin Blanc, Cabernet Franc).
Ideal buyer: ${icp.sizeBand}; portfolio fit: ${icp.portfolioFit.join(", ")}; price: ${icp.priceBand}.
The company is "${c.name}" (TTB owner "${c.ownerName}", ${c.city}, CA).
Use ONLY the numbered snippets. A snippet about another company does not count. Never use outside knowledge.
For EACH signal below return {"id","fired","snippet","quote"}: fired=true only if a snippet proves it for ${c.name};
then "snippet" is its number and "quote" is an exact copy (max 200 characters) of the words in that snippet that prove it.
Signals:
${WEB_SIGNALS.map((s) => `- ${s.id}: ${s.instruction}`).join("\n")}
Return JSON: {"signals":[...]}`;

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Snippets that may be used as evidence: own-site chunks, or third-party chunks that name the company. */
function usableSnippets(c: Candidate, snippets: Snippet[]): Snippet[] {
  const keys = nameKeys(c);
  const tokens = distinctiveTokens(`${c.name} ${c.ownerName}`).map((t) => t.toLowerCase());
  return snippets.filter((s) => s.ownSite || mentionsName(s.text, keys) || tokens.some((t) => t.length >= 5 && s.text.toLowerCase().includes(t)));
}

async function scoreCandidate(e: CandidateEvidence, index: PageIndex, icp: ICP): Promise<ScoredLead | null> {
  const c = e.candidate;
  const queries = [`${icp.portfolioFit.join(", ")} importer`, ...WEB_SIGNALS.map((s) => s.label)];
  const snippets = usableSnippets(c, await index.query(c.id, queries, 4)).slice(0, 24);
  const hits: SignalHit[] = [];
  const pf = await extractPortfolio(c, e.pages);
  if (pf) hits.push(...portfolioHits(pf));

  if (snippets.length && hasMistral()) {
    const key = cacheKey({ c: c.id, s: snippets.map((s) => s.id), sig: WEB_SIGNALS.map((s) => [s.id, s.instruction]), icp: icp.portfolioFit, model: process.env.MISTRAL_MODEL });
    let j = readCache<Judgement>("judge", key);
    if (!j) {
      const listing = snippets.map((s, i) => `[${i}] (${s.url})\n${s.text}`).join("\n\n");
      j = await chatJSON([{ role: "system", content: JUDGE_PROMPT(c, icp) }, { role: "user", content: listing }], validateJudgement).catch((err) => {
        console.error(`[discover] Mistral failed for ${c.name}:`, err);
        return null;
      });
      if (j) writeCache("judge", key, j);
    }
    for (const v of j?.signals ?? []) {
      const def = WEB_SIGNALS.find((s) => s.id === v.id);
      const s = snippets[v.snippet];
      // Every claim must be a verbatim quote from a retrieved snippet; otherwise it is dropped.
      if (!def || !v.fired || !s || squash(v.quote).length < 8 || !squash(s.text).includes(squash(v.quote))) continue;
      if (hits.some((h) => h.id === def.id)) continue;
      if (def.id === "price_match" && !(v.quote.match(/\$\s?(\d+(?:\.\d+)?)/g) ?? []).some((m) => { const n = Number(m.replace(/[$\s]/g, "")); return n >= 25 && n <= 55; })) continue;
      if (def.id === "boutique_size" && pf && pf.producers.length > 150) continue; // the structured portfolio says otherwise
      if (def.id === "recent_or_hiring" && !/(hiring|(is|are) looking for|open (position|role)|job (opening|posting)|join (our|the) team|expan(d|ds|ding|sion) (in)?to)/i.test(v.quote)) continue;
      // Mega-distributor needs hard evidence: a count >= 500 (SKUs/products/brands) or "largest" / "national brands".
      if (def.id === "mega_distributor" && !(/\b(largest|national brands)\b/i.test(v.quote) || (v.quote.match(/\d[\d,]{2,}/g) ?? []).some((n) => Number(n.replace(/,/g, "")) >= 500))) continue;
      hits.push({ id: def.id, label: def.label, points: signalPoints(def), snippet: v.quote.trim(), url: s.url, title: s.title || undefined });
    }
  }

  // TTB evidence: "issued since the last publication" flag in the permit list.
  if (c.newPermit && !hits.some((h) => h.id === "recent_or_hiring")) {
    const def = SIGNALS.find((s) => s.id === "recent_or_hiring")!;
    hits.push({ id: def.id, label: def.label, points: signalPoints(def), snippet: `TTB permit ${c.permits[0].number} flagged as newly issued`, url: TTB_LIST_URL, title: "TTB List of Permittees" });
  }

  const sources: Source[] = [];
  const addSource = (url: string, title: string | undefined, snippet: string) => {
    if (url && !sources.some((x) => x.url === url && x.snippet === snippet)) sources.push({ url, title, snippet });
  };
  for (const h of hits) addSource(h.url, h.title, h.snippet);
  // Portfolio evidence: one source per own-site page, listing the producers found there.
  for (const url of [...new Set((pf?.producers ?? []).map((p) => p.url))].slice(0, 5)) {
    const names = pf!.producers.filter((p) => p.url === url).map(fmt);
    addSource(url, undefined, `Producers listed: ${names.slice(0, 12).join("; ")}${names.length > 12 ? ` (+${names.length - 12} more)` : ""}`);
  }
  if (!sources.length) return null; // no evidence, no lead

  const { fitScore, tier } = scoreHits(hits);
  const own = e.pages.find((p) => p.ownSite);
  return {
    portfolioDetail: pf?.producers ?? [],
    id: c.id,
    name: c.name,
    type: c.hasWholesaler ? "importer_distributor" : "importer",
    state: "CA",
    city: c.city,
    address: c.address,
    website: own ? new URL(own.url).origin : undefined,
    permits: c.permits,
    portfolio: (pf?.producers ?? []).map((p) => `${fmt(p)}${p.country ? `, ${p.country}` : ""}`),
    fitScore,
    tier,
    signals: hits.map((h) => `${h.points > 0 ? "+" : ""}${h.points} ${h.label}`),
    sources,
    stage: "matched",
    enriched: false,
    scoreBreakdown: hits.sort((a, b) => b.points - a.points),
  };
}

/** Full pipeline: candidate pool -> Moss index -> per-candidate Mistral scoring. Sorted by fitScore. */
export async function discoverLeads(icp: ICP, u: Usage): Promise<{ leads: ScoredLead[]; backend: string }> {
  const pool = await discoverCandidates(u);
  const index = await buildIndex(pool.flatMap((e) => e.pages));
  const leads: ScoredLead[] = [];
  for (let i = 0; i < pool.length; i += 4) {
    const batch = await Promise.all(pool.slice(i, i + 4).map((e) => scoreCandidate(e, index, icp)));
    leads.push(...batch.filter((l): l is ScoredLead => l !== null));
  }
  return { leads: leads.sort((a, b) => b.fitScore - a.fitScore), backend: index.backend };
}
