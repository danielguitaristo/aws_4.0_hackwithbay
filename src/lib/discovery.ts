// Discovery (owner A): TTB permit lists -> ranked California candidates -> Tavily web pages.
// Server-only. Source files: data/ttb/FRL_Alcohol_{Importer,Wholesaler}_Permit_List.csv
// (https://www.ttb.gov/public-information/foia/list-of-permittees).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { tavily } from "@tavily/core";
import type { Permit } from "./types";
import { asNumber, asObject, asString, cacheKey, chatJSON, hasMistral, readCache, writeCache } from "./llm";
import { signalQueries } from "./signals";

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
    if (whs.length) (score += 5), reasons.push("Holds CA importer + wholesaler permits (importer-distributor)");
    else reasons.push("Holds CA importer permit");
    for (const [re, pts, why] of NAME_SIGNALS) if (re.test(names)) (score += pts), reasons.push(why);
    const nameScore = score;
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

/** Keep only pages on the company's own site or that name it, so no claim is borrowed from another importer. */
function relevantPages(c: Candidate, results: RawResult[], forceOwn = false): WebPage[] {
  const keys = nameKeys(c);
  return results
    .map((r) => {
      const text = (r.rawContent || r.content || "").trim();
      const named = mentionsName(`${r.title} ${text}`, keys);
      const local = new RegExp(`\\b(${c.city}|California)\\b`, "i").test(text);
      // Own site: domain spells the name and the page names it or its city; a partial domain match
      // must name the company in full (so grandcruselections.com is not "Grand Cru Imports").
      const match = siteMatch(r.url, keys);
      const ownSite = forceOwn || (match === "full" ? named || local : match === "partial" && named);
      return { candidateId: c.id, url: r.url, title: r.title, text, ownSite, keep: ownSite || (named && local) };
    })
    .filter((p) => p.text.length > 0 && p.keep)
    .map(({ keep, ...p }) => (void keep, p));
}

/** Base search for one candidate (README step 4). `paid` is true when Tavily was actually called. */
export async function fetchPages(c: Candidate, opts: { cacheOnly?: boolean } = {}): Promise<{ pages: WebPage[]; paid: boolean }> {
  const u: Usage = { searches: 0 };
  const results = opts.cacheOnly && !fs.existsSync(cacheFile(searchQuery(c))) ? [] : ((await search(searchQuery(c), u, {}, { candidate: c.name })) ?? []);
  return { pages: relevantPages(c, results), paid: u.searches > 0 };
}

// Producer / portfolio pages on an importer's own site.
const PORTFOLIO_PATH = /(producer|portfolio|grower|winemaker|vigneron|domaine|estate|france|french|loire|our-wines|wines|brands|book)/i;

/**
 * Best-practice two-step on the importer's own site: map() to list URLs, then extract()
 * the producer/portfolio pages (full producer lists are needed to count Loire growers).
 */
async function ownSitePages(c: Candidate, origin: string, u: Usage): Promise<WebPage[]> {
  const urls = await cachedTavily<string[]>(`map:${origin}`, u, async () => (await tavilyClient().map(origin, { maxDepth: 2, limit: 60 })).results, { candidate: c.name });
  const picks = [...new Set((urls ?? []).filter((x) => PORTFOLIO_PATH.test(new URL(x).pathname)))].slice(0, 5);
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
