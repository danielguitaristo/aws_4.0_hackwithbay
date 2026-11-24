# Millésime

Millésime is an AI go-to-market engine that helps small French wine estates export to the US.

US law forces every foreign winery to sell through a licensed US importer, then a state distributor (the three-tier system). Small estates have no export team and no idea which of the thousands of importers fits them. Millésime takes the estate's description, infers the ideal US importer/distributor, finds real ones from public federal and California license data, explains the fit with cited sources, drafts outreach that a human approves, and tracks every lead to a signed deal.

Built at HackwithBay 4.0 (AWS Builder Loft, SF).

https://millesime-xj17.onrender.com/home

## Setup

```bash
npm install
cp .env.example .env.local   # fill in your keys
npm run dev                  # http://localhost:3000
```

## Pipeline

1. **Intake → ICP**: estate description → ideal US importer profile (states, NAICS 424820, size, portfolio fit, triggers) with per-field confidence and expansion segments (Mistral).
2. **Discovery**: licensed importers and wholesalers from public data, then their websites (Tavily) for portfolio and signals, indexed in Moss so every claim has a source.
3. **Knowledge graph**: Company, Person, Product, Competitor, Signal nodes. Key query: importers that already carry growers from the same French region but not this appellation (Neo4j).
4. **Enrichment & outreach**: Hunter contact lookup, English outreach drafts, mandatory human approval before sending.
5. **Dashboard**: Kanban (Matched → Contacted → Samples sent → Tasting → Signed/Lost), agent vs. rep attribution, conversion and A/B analytics.
6. **Billing**: Flexprice usage metering; enrichment is blocked when credits run out.

## Public data sources

| Source | What it gives |
|---|---|
| [TTB List of Permittees](https://www.ttb.gov/public-information/foia/list-of-permittees) | Every federal importer and wholesaler permit (name, address, state). Importer + wholesaler at the same company in CA = importer-distributor, the best target. |
| [California ABC data export](https://www.abc.ca.gov/licensing/licensing-reports) | Daily CSV of all CA alcohol licenses, with issue dates (new license = buying signal). |
| [TTB COLA Public Registry](https://ttbonline.gov/colasonline/publicSearchColasBasic.do) | Label approvals by importer and origin: who already imports from the Loire. |
| Importer websites (Tavily) | Producer portfolio, "where to buy" pages, hiring posts. |

## Team & ownership

| Owner | Area | Files |
|---|---|---|
| A | Intake, ICP, discovery, retrieval | `src/app/api/icp`, `src/app/api/discover`, `src/lib/{llm,discovery,retrieval}.ts`, `data/` (permit CSVs) |
| B | Graph, enrichment, outreach, billing | `src/app/api/{leads,messages,graph,billing}`, `src/lib/{graph,enrich,billing}.ts` |
| C | UI, dashboard, demo | `src/app/**/page.tsx`, `src/components/` |

**Shared contract:** `src/lib/types.ts`. Change it only after telling the team.
**Mock data:** `src/lib/demo.ts` (demo estate + fictional leads for UI work).

## Git workflow

- One branch per person: `a/...`, `b/...`, `c/...`. Merge to `main` small and often.
- Run `npm run build` before merging.
- `main` must always run the demo.
