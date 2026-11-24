import { NextResponse } from "next/server";
import {
  STAGES,
  type Actor,
  type Domaine,
  type Lead,
  type Stage,
} from "@/lib/types";
import {
  addEvent,
  addThought,
  getDomaine,
  getLead,
  listEvents,
  listLeads,
  listMessages,
  listThoughts,
  setDomaine,
  updateLead,
  upsertLeads,
} from "@/lib/store";
import { enrichLead } from "@/lib/enrich";
import { syncStateToNeo4j } from "@/lib/graph";

function computeAnalytics() {
  const leads = listLeads();
  const events = listEvents();
  const messages = listMessages();

  const stageCounts: Record<Stage, number> = {
    matched: 0,
    contacted: 0,
    replied: 0,
    samples_sent: 0,
    tasting: 0,
    signed: 0,
    lost: 0,
  };

  for (const lead of leads) {
    stageCounts[lead.stage] = (stageCounts[lead.stage] || 0) + 1;
  }

  let agentActions = 0;
  let repActions = 0;
  for (const evt of events) {
    if (evt.actor === "agent") agentActions += 1;
    else repActions += 1;
  }

  const variantStats: Record<string, { drafted: number; approved: number; sent: number; rejected: number }> = {};
  for (const msg of messages) {
    const key = msg.variant || "A";
    if (!variantStats[key]) {
      variantStats[key] = { drafted: 0, approved: 0, sent: 0, rejected: 0 };
    }
    variantStats[key].drafted += 1;
    if (msg.status === "approved") variantStats[key].approved += 1;
    if (msg.status === "sent") variantStats[key].sent += 1;
    if (msg.status === "rejected") variantStats[key].rejected += 1;
  }

  const totalLeads = leads.length || 1;
  const contactedOrFurther = leads.filter((l) => l.stage !== "matched" && l.stage !== "lost").length;
  const conversionRates = {
    contactedRate: Number(((contactedOrFurther / totalLeads) * 100).toFixed(1)),
    signedRate: Number(((stageCounts.signed / totalLeads) * 100).toFixed(1)),
  };

  return {
    totalLeads: leads.length,
    enrichedCount: leads.filter((l) => l.enriched).length,
    stageCounts,
    attribution: { agentActions, repActions },
    variantStats,
    conversionRates,
  };
}

export async function GET() {
  return NextResponse.json({
    domaine: getDomaine(),
    leads: listLeads(),
    events: listEvents(),
    thoughts: listThoughts(),
    analytics: computeAnalytics(),
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: "ingest" | "enrich" | "move_stage";
      leadId?: string;
      stage?: Stage;
      actor?: Actor;
      note?: string;
      leads?: Lead[];
      domaine?: Domaine;
    };

    if (body.action === "ingest" || (!body.action && Array.isArray(body.leads))) {
      if (body.domaine) {
        setDomaine(body.domaine);
      }
      const incoming = Array.isArray(body.leads) ? body.leads : [];
      const saved = upsertLeads(incoming);
      await syncStateToNeo4j(getDomaine(), listLeads(), listMessages());
      addThought("planner", `Ingested ${saved.length} buyer leads into pipeline and synced to knowledge graph.`);

      return NextResponse.json({
        leads: listLeads(),
        ingested: saved.length,
        analytics: computeAnalytics(),
      });
    }

    if (body.action === "enrich") {
      if (!body.leadId) {
        return NextResponse.json({ error: "leadId is required for enrich" }, { status: 400 });
      }
      const lead = getLead(body.leadId);
      if (!lead) {
        return NextResponse.json({ error: `Lead ${body.leadId} not found` }, { status: 404 });
      }

      const result = await enrichLead(lead);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, enrichmentBlocked: result.status === 402 },
          { status: result.status },
        );
      }

      await syncStateToNeo4j(getDomaine(), listLeads(), listMessages());
      return NextResponse.json({
        lead: result.lead,
        source: result.source,
        events: listEvents(lead.id),
        thoughts: listThoughts(),
        analytics: computeAnalytics(),
      });
    }

    if (body.action === "move_stage") {
      if (!body.leadId || !body.stage || !STAGES.includes(body.stage)) {
        return NextResponse.json({ error: "Valid leadId and stage are required" }, { status: 400 });
      }
      const actor: Actor = body.actor === "agent" ? "agent" : "rep";
      const updated = updateLead(body.leadId, { stage: body.stage });
      if (!updated) {
        return NextResponse.json({ error: `Lead ${body.leadId} not found` }, { status: 404 });
      }

      const event = addEvent({
        leadId: updated.id,
        type: "stage",
        stage: body.stage,
        actor,
        note: body.note || `Moved ${updated.name} to ${body.stage} (${actor}).`,
      });
      addThought("planner", `${actor === "rep" ? "Sales rep" : "Agent"} moved ${updated.name} to stage "${body.stage}".`);

      return NextResponse.json({
        lead: updated,
        event,
        analytics: computeAnalytics(),
      });
    }

    return NextResponse.json(
      { error: "Unsupported action. Use ingest, enrich, or move_stage." },
      { status: 400 },
    );
  } catch (err) {
    console.error("[api/leads] POST error:", err);
    return NextResponse.json({ error: "Failed to process leads request" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as {
      leadId?: string;
      stage?: Stage;
      actor?: Actor;
      note?: string;
    };
    if (!body.leadId || !body.stage || !STAGES.includes(body.stage)) {
      return NextResponse.json({ error: "Valid leadId and stage are required" }, { status: 400 });
    }
    const actor: Actor = body.actor === "agent" ? "agent" : "rep";
    const updated = updateLead(body.leadId, { stage: body.stage });
    if (!updated) {
      return NextResponse.json({ error: `Lead ${body.leadId} not found` }, { status: 404 });
    }
    const event = addEvent({
      leadId: updated.id,
      type: "stage",
      stage: body.stage,
      actor,
      note: body.note || `Moved ${updated.name} to ${body.stage} (${actor}).`,
    });
    return NextResponse.json({ lead: updated, event, analytics: computeAnalytics() });
  } catch (err) {
    console.error("[api/leads] PATCH error:", err);
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
  }
}
