# Millésime

**Find the US importer made for your wine.**

![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs) ![Mistral](https://img.shields.io/badge/Mistral-LLM-FA520F) ![Tavily](https://img.shields.io/badge/Tavily-web%20search-5A4FCF) ![Moss](https://img.shields.io/badge/Moss-retrieval-2E7D32) ![Neo4j](https://img.shields.io/badge/Neo4j-graph-4581C3?logo=neo4j&logoColor=white) ![Flexprice](https://img.shields.io/badge/Flexprice-billing-111111) ![Render](https://img.shields.io/badge/Render-hosting-46E3B7?logo=render&logoColor=black)

**Live demo:** https://millesime-xj17.onrender.com (free instance: the first load can take about 1 minute)
**Demo video:** TODO

## The problem

- US law sends every foreign wine through the **three-tier system**: a federally licensed importer, then a state-licensed distributor, then the retailer.
- California alone has **4,712 importer permits** in the federal TTB registry.
- A small French estate has no export team and no way to tell which of them would actually carry its wine.
- Cold outreach rarely works: a generic email does not show an importer why this wine fits its book.

## What Millésime does

- **Ideal customer profile (ICP):** turns the estate's description into the profile of its ideal US buyer, with a confidence score per field.
- **Real, licensed importers only:** every lead comes from the TTB federal permit registry (importer and wholesaler permits), never from a model's imagination.
- **Cited, checked evidence:** every signal carries the verbatim sentence and its URL, and an entity check confirms it is about that company.
- **Fit × Opening score with an angle:** does this importer sell wines like yours, and is there room for yours? Each lead says how to approach it.
- **Human-in-the-loop outreach:** personalized drafts a human approves, a Kanban from *Matched* to *Signed*, and usage-based credits with Flexprice.

## How it works

1. **Intake → ICP** (Mistral). The estate form becomes an ICP; a per-estate **region profile** (appellations, styles, queries) drives every later step.
2. **Candidates** (TTB). Licensed importers of the target state, importer-distributors first, plus companies found by reverse searches, lookalike estates and estates' own sites, kept only if they match a TTB permit.
3. **Evidence** (Tavily). Searches per importer, and *map + extract* of its own portfolio pages; Mistral turns them into a structured portfolio.
4. **Retrieval** (Moss). Every page chunk is indexed; only the snippets closest to the ICP reach the model.
5. **Scoring** (Mistral + code). Signals with verbatim quotes, entity check, permit match, Fit × Opening, tier and angle.
6. **Graph, enrichment, outreach, billing.** Neo4j knowledge graph, Hunter contacts, HITL drafts sent through Gmail, Kanban, Flexprice metering.

Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Trust by design

| Rule | What it prevents |
|---|---|
| Every lead matches a **TTB permit** (name + city); the importer's own website must show the permit city or holder name, otherwise the lead is capped at tier C | Leads that cannot legally import, or the wrong company |
| **Entity check** on every fired signal: only `same_company` counts; `sister_or_related_company`, `different_company` and `unclear` become `unknown` (0 points, reason shown) | Homonyms and sister companies |
| **No AI-generated sources** (auto-generated company profiles, data brokers); producer sheets never prove an importer's focus | Circular or misattributed evidence |
| **Verbatim quotes**, checked in code against the source text | Invented claims |
| **Dated hiring signals**: a post from the last 12 months with a named role; undated LinkedIn activity never counts | Stale signals |
| **Coverage-aware scoring** ("catalogue read: 26/143"): an absence on a partially read catalogue is `unknown`, never a negative | False "portfolio hole" or false "saturation" |

## Tech & sponsors

| Tool | What it does in Millésime |
|---|---|
| **Next.js 15 / React 19** | The app (11 screens) and its API routes |
| **Mistral** | ICP, region profile, portfolio extraction, signal detection, entity check, outreach drafts (JSON mode) |
| **Tavily** | Web search, site map and page extraction for each importer, budgeted and cached |
| **Moss** | Semantic index of page chunks; returns the evidence closest to the ICP |
| **Neo4j** | Knowledge graph of importers, people, competitors and signals; appellation gaps and warm intros |
| **Flexprice** | Usage metering and the credit wallet that gates paid actions |
| **Render** | Hosting, auto-deploy from `main` |
| Hunter | Decision-maker contact lookup on the importer's domain |
| Gmail API | Sending in thread, reply detection, locked demo recipient |
| TTB permit registry | Ground truth: federal importer and wholesaler permits |

## Getting started

Prerequisites: **Node.js 20+**.

```bash
npm install --onnxruntime-node-install-cuda=skip
cp .env.example .env.local   # fill in keys only for live runs
npm run dev                  # http://localhost:3000
```

The demo estates (a Touraine estate, and a Côte Chalonnaise test estate) are served from the committed cache in `data/cache/`, with **no API key and no paid call**. Any other estate starts a live run (about 3 minutes) and needs the keys below.

## Environment variables

| Variable | Required | Owner | Purpose |
|---|---|---|---|
| `MISTRAL_API_KEY` | Live runs | A + B | Mistral API |
| `MISTRAL_MODEL` | Optional | A + B | Model for every call; use `mistral-medium-latest` (the committed caches were built with it) |
| `TAVILY_API_KEY` | Live runs | A | Web search and extraction |
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` | Live runs | A | Moss semantic index |
| `TAVILY_RUN_BUDGET` | Optional | A | Max Tavily credits per live run (`0` = cache only) |
| `LIVE_GLOBAL_MAX` | Optional | A | Live runs per hour for all visitors, per route (default 20) |
| `LIVE_IP_MAX` | Optional | A | Live runs per IP per 10 minutes, per route (default 10) |
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` | Optional | B | Knowledge graph (in-memory graph if unset) |
| `HUNTER_API_KEY` | Optional | B | Contact enrichment |
| `FLEXPRICE_API_KEY` | Optional | B | Usage metering (local ledger if unset) |
| `FLEXPRICE_API_HOST` | Optional | B | Flexprice API host override |
| `STARTING_CREDITS` | Optional | B | Demo credit balance (default 200) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | To send email | C | Gmail OAuth client |
| `GOOGLE_REDIRECT_URI` | Optional | C | OAuth redirect (default `<site>/api/gmail/callback`) |
| `GMAIL_DEMO_RECIPIENT` | To send email | C | Every letter goes to this test inbox; sending is locked without it |
| `GMAIL_ALLOW_REAL_SEND` | Optional | C | `true` to email real importers on purpose |

Keys stay server-side (never `NEXT_PUBLIC_`). `.env.local` is git-ignored.

## Deployment (Render)

Node web service, auto-deploy on every push to `main`.

- **Build command:** `npm install --onnxruntime-node-install-cuda=skip && npm run build`
- **Start command:** `npm run start`
- **Environment:** the variables above, set in the Render dashboard.

## Project structure

```
src/
  app/          screens (page.tsx) and API routes
    api/        icp, discover (A) · leads, messages, graph, billing (B) · states, gmail (C)
  components/   UI kit and maps
  lib/          discovery, signals, retrieval, llm (A) · store, graph, enrich, billing (B)
                app-state, gmail, places (C) · types.ts (shared contract)
data/
  ttb/          TTB importer and wholesaler permit lists (CSV)
  cache/        committed cache of every external call (demo runs offline)
docs/           ARCHITECTURE.md, screenshots/
```

## Team

| | Who | Part |
|---|---|---|
| A | **Daniel Duong** | Intake, ICP, discovery engine, scoring, deployment |
| B | **Arthur Moracchini** | Neo4j graph, Hunter enrichment, outreach & HITL, Flexprice billing |
| C | **Colomban Dubreuil** | Product design, UI, Gmail, maps, analytics |

Built at **HackwithBay 4.0**, AWS Builder Loft, San Francisco, November 24, 2026, with Claude Code.

## Limitations & next steps

- A live discovery run takes about 3 minutes (dozens of Tavily and Mistral calls). Next: stream leads as they are scored.
- Contacts depend on Hunter's coverage of small importers' domains.
- Next data source: US customs records (bills of lading), to prove which importer actually receives which estate's wine.
- More states: the TTB registry covers the whole US; California is supported today, other states come next.
