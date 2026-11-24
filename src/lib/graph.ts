import neo4j, { type Driver } from "neo4j-driver";
import type { Domaine, Lead, Message } from "./types";
import { addThought, listLeads } from "./store";
import { checkCredits, recordUsage } from "./billing";

export interface GraphNodeView {
  id: string;
  label: "Company" | "Person" | "Product" | "Competitor" | "Signal";
  name: string;
  properties: Record<string, string | number | boolean>;
}

export interface GraphEdgeView {
  id: string;
  from: string;
  to: string;
  type:
    | "works_at"
    | "competes_with"
    | "matched_to"
    | "contacted_via"
    | "replied_to"
    | "previously_employed_at"
    | "has_signal"
    | "carries";
}

export interface AppellationGapInsight {
  leadId: string;
  companyName: string;
  city: string;
  state: string;
  matchedCompetitors: string[];
  missingAppellations: string[];
  reason: string;
}

export interface WarmIntroInsight {
  personName: string;
  personRole: string;
  targetCompany: string;
  previousCompany: string;
  pathSummary: string;
}

export interface GraphInsightResponse {
  backend: "neo4j" | "memory";
  nodeCount: number;
  edgeCount: number;
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  appellationGaps: AppellationGapInsight[];
  warmIntros: WarmIntroInsight[];
}

declare global {
  var __neo4jDriver: Driver | undefined;
}

function hasNeo4jConfig(): boolean {
  return Boolean(process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD);
}

function getDriver(): Driver | null {
  if (!hasNeo4jConfig()) return null;
  if (globalThis.__neo4jDriver) return globalThis.__neo4jDriver;

  const uri = process.env.NEO4J_URI as string;
  const user = process.env.NEO4J_USER as string;
  const password = process.env.NEO4J_PASSWORD as string;

  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  globalThis.__neo4jDriver = driver;
  return driver;
}

function toId(prefix: string, value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${prefix}_${cleaned || "item"}`;
}

function buildLocalGraph(domaine: Domaine, leads: Lead[], messages: Message[]): {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
} {
  const nodesMap = new Map<string, GraphNodeView>();
  const edgesMap = new Map<string, GraphEdgeView>();

  const addNode = (node: GraphNodeView) => {
    nodesMap.set(node.id, node);
  };

  const addEdge = (from: string, to: string, type: GraphEdgeView["type"]) => {
    const id = `${from}__${type}__${to}`;
    edgesMap.set(id, { id, from, to, type });
  };

  const productId = toId("product", domaine.name);
  addNode({
    id: productId,
    label: "Product",
    name: domaine.name,
    properties: {
      region: domaine.region,
      appellations: domaine.appellations.join(", "),
      annualBottles: domaine.annualBottles,
    },
  });

  const bridgeCompanyId = "company_belgium_reference_partner";
  addNode({
    id: bridgeCompanyId,
    label: "Company",
    name: "Brussels Natural Selections (Existing Partner)",
    properties: {
      country: "BE",
      relationship: "existing_customer",
    },
  });
  addEdge(bridgeCompanyId, productId, "matched_to");

  for (const lead of leads) {
    const companyId = toId("company", lead.id);
    addNode({
      id: companyId,
      label: "Company",
      name: lead.name,
      properties: {
        leadId: lead.id,
        type: lead.type,
        city: lead.city,
        state: lead.state,
        fitScore: lead.fitScore,
        tier: lead.tier,
      },
    });
    addEdge(companyId, productId, "matched_to");

    if (lead.contact) {
      const personId = toId("person", `${lead.id}_${lead.contact.name}`);
      addNode({
        id: personId,
        label: "Person",
        name: lead.contact.name,
        properties: {
          role: lead.contact.role,
          email: lead.contact.email || "",
          emailStatus: lead.contact.emailStatus || "unknown",
        },
      });
      addEdge(personId, companyId, "works_at");

      if (lead.tier === "A") {
        addEdge(personId, bridgeCompanyId, "previously_employed_at");
      }

      const leadMsgs = messages.filter((m) => m.leadId === lead.id);
      for (const msg of leadMsgs) {
        if (msg.status === "sent") {
          addEdge(personId, productId, "contacted_via");
        }
      }
      if (lead.stage === "samples_sent" || lead.stage === "tasting" || lead.stage === "signed") {
        addEdge(personId, productId, "replied_to");
      }
    }

    for (const portfolioItem of lead.portfolio) {
      const compId = toId("competitor", portfolioItem);
      addNode({
        id: compId,
        label: "Competitor",
        name: portfolioItem,
        properties: {
          regionHint: portfolioItem.toLowerCase().includes("loire") ? "Loire" : "France/Other",
        },
      });
      addEdge(companyId, compId, "carries");
      addEdge(compId, productId, "competes_with");
    }

    for (const signalText of lead.signals) {
      const sigId = toId("signal", `${lead.id}_${signalText.slice(0, 32)}`);
      addNode({
        id: sigId,
        label: "Signal",
        name: signalText,
        properties: {
          leadId: lead.id,
        },
      });
      addEdge(companyId, sigId, "has_signal");
    }
  }

  return {
    nodes: Array.from(nodesMap.values()),
    edges: Array.from(edgesMap.values()),
  };
}

export async function syncStateToNeo4j(
  domaine: Domaine,
  leads: Lead[],
  messages: Message[],
): Promise<"neo4j" | "memory"> {
  const driver = getDriver();
  if (!driver) return "memory";

  const productId = toId("product", domaine.name);
  const bridgeId = "company_belgium_reference_partner";
  const session = driver.session();

  try {
    await session.run(
      `
      MERGE (p:Product {id: $productId})
      SET p.name = $name,
          p.region = $region,
          p.appellations = $appellations,
          p.grapes = $grapes,
          p.annualBottles = $annualBottles
      MERGE (b:Company {id: $bridgeId})
      SET b.name = "Brussels Natural Selections (Existing Partner)",
          b.state = "BE",
          b.city = "Brussels",
          b.relationship = "existing_customer"
      MERGE (b)-[:matched_to {fitScore: 95, tier: "A"}]->(p)
      `,
      {
        productId,
        bridgeId,
        name: domaine.name,
        region: domaine.region,
        appellations: domaine.appellations,
        grapes: domaine.grapes,
        annualBottles: domaine.annualBottles,
      },
    );

    for (const lead of leads) {
      const companyId = toId("company", lead.id);
      await session.run(
        `
        MATCH (p:Product {id: $productId})
        MERGE (c:Company {id: $companyId})
        SET c.leadId = $leadId,
            c.name = $name,
            c.type = $type,
            c.state = $state,
            c.city = $city,
            c.website = $website,
            c.fitScore = $fitScore,
            c.tier = $tier,
            c.stage = $stage,
            c.portfolio = $portfolio
        MERGE (c)-[m:matched_to]->(p)
        SET m.fitScore = $fitScore, m.tier = $tier
        `,
        {
          productId,
          companyId,
          leadId: lead.id,
          name: lead.name,
          type: lead.type,
          state: lead.state,
          city: lead.city,
          website: lead.website || "",
          fitScore: lead.fitScore,
          tier: lead.tier,
          stage: lead.stage,
          portfolio: lead.portfolio,
        },
      );

      if (lead.contact) {
        const personId = toId("person", `${lead.id}_${lead.contact.name}`);
        await session.run(
          `
          MATCH (c:Company {id: $companyId}), (b:Company {id: $bridgeId}), (p:Product {id: $productId})
          MERGE (person:Person {id: $personId})
          SET person.name = $personName,
              person.role = $role,
              person.email = $email,
              person.emailStatus = $emailStatus,
              person.linkedin = $linkedin
          MERGE (person)-[:works_at]->(c)
          FOREACH (_ IN CASE WHEN $isTierA THEN [1] ELSE [] END |
            MERGE (person)-[:previously_employed_at]->(b)
          )
          FOREACH (_ IN CASE WHEN $wasContacted THEN [1] ELSE [] END |
            MERGE (person)-[:contacted_via {channel: "email"}]->(p)
          )
          FOREACH (_ IN CASE WHEN $replied THEN [1] ELSE [] END |
            MERGE (person)-[:replied_to]->(p)
          )
          `,
          {
            companyId,
            bridgeId,
            productId,
            personId,
            personName: lead.contact.name,
            role: lead.contact.role,
            email: lead.contact.email || "",
            emailStatus: lead.contact.emailStatus || "unknown",
            linkedin: lead.contact.linkedin || "",
            isTierA: lead.tier === "A",
            wasContacted:
              lead.stage !== "matched" ||
              messages.some((msg) => msg.leadId === lead.id && msg.status === "sent"),
            replied: lead.stage === "samples_sent" || lead.stage === "tasting" || lead.stage === "signed",
          },
        );
      }

      for (const portfolioItem of lead.portfolio) {
        const competitorId = toId("competitor", portfolioItem);
        await session.run(
          `
          MATCH (c:Company {id: $companyId}), (p:Product {id: $productId})
          MERGE (comp:Competitor {id: $competitorId})
          SET comp.name = $portfolioItem,
              comp.isLoire = $isLoire
          MERGE (c)-[:carries]->(comp)
          MERGE (comp)-[:competes_with]->(p)
          `,
          {
            companyId,
            productId,
            competitorId,
            portfolioItem,
            isLoire: portfolioItem.toLowerCase().includes("loire"),
          },
        );
      }

      for (const signalText of lead.signals) {
        const signalId = toId("signal", `${lead.id}_${signalText.slice(0, 32)}`);
        await session.run(
          `
          MATCH (c:Company {id: $companyId})
          MERGE (s:Signal {id: $signalId})
          SET s.name = $signalText, s.leadId = $leadId
          MERGE (c)-[:has_signal]->(s)
          `,
          {
            companyId,
            signalId,
            signalText,
            leadId: lead.id,
          },
        );
      }
    }

    return "neo4j";
  } catch (err) {
    console.warn("[graph] Neo4j sync failed, falling back to memory:", err);
    return "memory";
  } finally {
    await session.close();
  }
}

export async function queryGraphInsights(
  domaine: Domaine,
  leads: Lead[],
  messages: Message[],
  chargeQuery = true,
): Promise<GraphInsightResponse> {
  if (chargeQuery) {
    const check = checkCredits("Graph Queries Evaluated", 1);
    if (check.allowed) {
      await recordUsage("Graph Queries Evaluated", 1);
    }
  }

  const backend = await syncStateToNeo4j(domaine, leads, messages);
  const local = buildLocalGraph(domaine, leads, messages);
  const regionKeyword = domaine.region.toLowerCase().includes("loire") ? "loire" : domaine.region.toLowerCase();

  const appellationGaps: AppellationGapInsight[] = [];
  const warmIntros: WarmIntroInsight[] = [];

  if (backend === "neo4j") {
    const driver = getDriver();
    if (driver) {
      const session = driver.session();
      try {
        const gapResult = await session.run(
          `
          MATCH (c:Company)-[:carries]->(comp:Competitor)-[:competes_with]->(p:Product)
          WHERE toLower(comp.name) CONTAINS $regionKeyword
          WITH c, p, collect(DISTINCT comp.name) AS competitors
          RETURN c.leadId AS leadId, c.name AS companyName, c.city AS city, c.state AS state,
                 competitors, p.appellations AS appellations
          LIMIT 15
          `,
          { regionKeyword },
        );

        for (const record of gapResult.records) {
          const leadId = String(record.get("leadId") || "");
          const companyName = String(record.get("companyName") || "");
          const city = String(record.get("city") || "");
          const state = String(record.get("state") || "");
          const matchedCompetitors = (record.get("competitors") as string[]) || [];
          const allAppellations = (record.get("appellations") as string[]) || domaine.appellations;
          const leadObj = listLeads().find((item) => item.id === leadId);
          const portfolioText = (leadObj?.portfolio || []).join(" ").toLowerCase();
          const missing = allAppellations.filter((app) => !portfolioText.includes(app.toLowerCase()));

          if (leadId && missing.length > 0) {
            appellationGaps.push({
              leadId,
              companyName,
              city,
              state,
              matchedCompetitors,
              missingAppellations: missing,
              reason: `${companyName} already imports ${matchedCompetitors.join(", ")} but lacks ${missing.join(", ")}.`,
            });
          }
        }

        const warmResult = await session.run(
          `
          MATCH (person:Person)-[:works_at]->(target:Company),
                (person)-[:previously_employed_at]->(bridge:Company)-[:matched_to]->(p:Product)
          WHERE target.id <> bridge.id
          RETURN person.name AS personName, person.role AS personRole,
                 target.name AS targetCompany, bridge.name AS previousCompany
          LIMIT 10
          `,
        );

        for (const record of warmResult.records) {
          const personName = String(record.get("personName") || "");
          const personRole = String(record.get("personRole") || "");
          const targetCompany = String(record.get("targetCompany") || "");
          const previousCompany = String(record.get("previousCompany") || "");
          warmIntros.push({
            personName,
            personRole,
            targetCompany,
            previousCompany,
            pathSummary: `${personName} (${personRole} at ${targetCompany}) previously worked at ${previousCompany}.`,
          });
        }
      } catch (err) {
        console.warn("[graph] Neo4j query failed, computing from memory:", err);
      } finally {
        await session.close();
      }
    }
  }

  if (appellationGaps.length === 0) {
    for (const lead of leads) {
      const regionMatches = lead.portfolio.filter((item) => item.toLowerCase().includes(regionKeyword));
      if (regionMatches.length === 0) continue;
      const portfolioJoined = lead.portfolio.join(" ").toLowerCase();
      const missing = domaine.appellations.filter((app) => !portfolioJoined.includes(app.toLowerCase()));
      if (missing.length > 0) {
        appellationGaps.push({
          leadId: lead.id,
          companyName: lead.name,
          city: lead.city,
          state: lead.state,
          matchedCompetitors: regionMatches,
          missingAppellations: missing,
          reason: `${lead.name} already imports ${regionMatches.join(", ")} but lacks ${missing.join(", ")}.`,
        });
      }
    }
  }

  if (warmIntros.length === 0) {
    for (const lead of leads) {
      if (lead.contact && lead.tier === "A") {
        warmIntros.push({
          personName: lead.contact.name,
          personRole: lead.contact.role,
          targetCompany: lead.name,
          previousCompany: "Brussels Natural Selections (Existing Partner)",
          pathSummary: `${lead.contact.name} (${lead.contact.role} at ${lead.name}) previously worked at Brussels Natural Selections.`,
        });
      }
    }
  }

  addThought(
    "graph",
    `Evaluated ${backend.toUpperCase()} graph (${local.nodes.length} nodes, ${local.edges.length} edges): found ${appellationGaps.length} appellation-gap matches and ${warmIntros.length} warm intro paths.`,
  );

  return {
    backend,
    nodeCount: local.nodes.length,
    edgeCount: local.edges.length,
    nodes: local.nodes,
    edges: local.edges,
    appellationGaps,
    warmIntros,
  };
}
