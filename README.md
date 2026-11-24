# WineGTM

AI go-to-market engine for small French wine estates. A winemaker describes their estate; WineGTM infers who should buy it (wine shops, bistros, importers), finds real buyers with cited sources, maps them in a knowledge graph, drafts personalized outreach that a human approves, and tracks every lead on a pipeline dashboard.

Built at HackwithBay 4.0 (AWS Builder Loft, SF).

## Setup

```bash
npm install
cp .env.example .env.local   # fill in your keys
npm run dev                  # http://localhost:3000
```

## Pipeline

1. **Intake → ICP**: estate description → buyer profile with per-field confidence and expansion segments (Mistral).
2. **Discovery**: real buyers from the French company registry ([recherche-entreprises.api.gouv.fr](https://recherche-entreprises.api.gouv.fr), NAF 47.25Z cavistes, 56.10A restaurants, 56.30Z bars) + Tavily web search, indexed in Moss so every claim has a source.
3. **Knowledge graph**: Company, Person, Product, Competitor, Signal nodes; warm-intro and competitor queries (Neo4j).
4. **Enrichment & outreach**: Hunter contact lookup, French outreach drafts, mandatory human approval before sending.
5. **Dashboard**: Kanban (Matched → Contacted → Replied → Tasting booked → Listed/Lost), agent vs. rep attribution, conversion and A/B analytics.
6. **Billing**: Flexprice usage metering; enrichment is blocked when credits run out.

## Team & ownership

| Owner | Area | Files |
|---|---|---|
| A | Intake, ICP, discovery, retrieval | `src/app/api/icp`, `src/app/api/discover`, `src/lib/{llm,discovery,retrieval}.ts` |
| B | Graph, enrichment, outreach, billing | `src/app/api/{leads,messages,graph,billing}`, `src/lib/{graph,enrich,billing}.ts` |
| C | UI, dashboard, demo | `src/app/**/page.tsx`, `src/components/` |

**Shared contract:** `src/lib/types.ts`. Change it only after telling the team.
**Mock data:** `src/lib/demo.ts` (demo estate + fictional leads for UI work).

## Git workflow

- One branch per person: `a/...`, `b/...`, `c/...`. Merge to `main` small and often.
- Run `npm run build` before merging.
- `main` must always run the demo.
