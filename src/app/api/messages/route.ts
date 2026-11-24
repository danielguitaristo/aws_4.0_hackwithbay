import { NextResponse } from "next/server";
import {
  addEvent,
  addThought,
  getDomaine,
  getLead,
  getMessage,
  listEvents,
  listLeads,
  listMessages,
  listThoughts,
  updateLead,
  updateMessage,
} from "@/lib/store";
import { generateOutreachDraft } from "@/lib/enrich";
import { checkCredits, recordUsage } from "@/lib/billing";
import { syncStateToNeo4j } from "@/lib/graph";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId") || undefined;
  const messages = listMessages(leadId);

  const counts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    sent: 0,
  };
  for (const msg of messages) {
    counts[msg.status] += 1;
  }

  return NextResponse.json({
    messages,
    counts,
    events: listEvents(leadId),
    thoughts: listThoughts(),
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: "draft" | "approve" | "edit" | "reject" | "send";
      leadId?: string;
      messageId?: string;
      channel?: "email" | "linkedin";
      variant?: string;
      graphReason?: string;
      subject?: string;
      body?: string;
      note?: string;
    };

    if (body.action === "draft") {
      if (!body.leadId) {
        return NextResponse.json({ error: "leadId is required for draft" }, { status: 400 });
      }
      const lead = getLead(body.leadId);
      if (!lead) {
        return NextResponse.json({ error: `Lead ${body.leadId} not found` }, { status: 404 });
      }

      const draft = await generateOutreachDraft({
        domaine: getDomaine(),
        lead,
        channel: body.channel || "email",
        variant: body.variant || "A",
        graphReason: body.graphReason,
      });

      return NextResponse.json({ message: draft, messages: listMessages() });
    }

    if (!body.messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }
    const existing = getMessage(body.messageId);
    if (!existing) {
      return NextResponse.json({ error: `Message ${body.messageId} not found` }, { status: 404 });
    }

    if (body.action === "edit") {
      const updated = updateMessage(existing.id, {
        subject: typeof body.subject === "string" ? body.subject : existing.subject,
        body: typeof body.body === "string" ? body.body : existing.body,
      });
      addEvent({
        leadId: existing.leadId,
        type: "edited",
        actor: "rep",
        note: "Sales rep edited outreach copy before approval.",
      });
      addThought("reviewer", `Human rep edited message ${existing.id}.`);
      return NextResponse.json({ message: updated, messages: listMessages() });
    }

    if (body.action === "approve") {
      const hadEdits =
        (typeof body.subject === "string" && body.subject !== existing.subject) ||
        (typeof body.body === "string" && body.body !== existing.body);

      if (hadEdits) {
        addEvent({
          leadId: existing.leadId,
          type: "edited",
          actor: "rep",
          note: "Sales rep edited outreach copy during HITL review.",
        });
      }

      const updated = updateMessage(existing.id, {
        subject: typeof body.subject === "string" ? body.subject : existing.subject,
        body: typeof body.body === "string" ? body.body : existing.body,
        status: "approved",
      });

      addEvent({
        leadId: existing.leadId,
        type: "approved",
        actor: "rep",
        note: "Human rep approved message in HITL gateway.",
      });
      addThought("reviewer", `HITL approved message ${existing.id} (${existing.channel}, Variant ${existing.variant}).`);
      return NextResponse.json({ message: updated, messages: listMessages() });
    }

    if (body.action === "reject") {
      const updated = updateMessage(existing.id, { status: "rejected" });
      addEvent({
        leadId: existing.leadId,
        type: "rejected",
        actor: "rep",
        note: body.note || "Human rep rejected drafted outreach.",
      });
      addThought("reviewer", `HITL rejected message ${existing.id}.`);
      return NextResponse.json({ message: updated, messages: listMessages() });
    }

    if (body.action === "send") {
      if (existing.status !== "approved") {
        addThought("reviewer", `Blocked send for ${existing.id}: HITL approval required first.`);
        return NextResponse.json(
          { error: "HITL gate: message must be approved by a human before sending." },
          { status: 403 },
        );
      }

      const creditCheck = checkCredits("Outreach Sent", 1);
      if (!creditCheck.allowed) {
        return NextResponse.json(
          { error: creditCheck.reason, billingBlocked: true },
          { status: 402 },
        );
      }

      const updated = updateMessage(existing.id, { status: "sent" });
      addEvent({
        leadId: existing.leadId,
        type: "sent",
        actor: "rep",
        note: `Dispatched ${existing.channel} outreach (Variant ${existing.variant}) after HITL approval.`,
      });

      const lead = getLead(existing.leadId);
      if (lead && lead.stage === "matched") {
        updateLead(lead.id, { stage: "contacted" });
        addEvent({
          leadId: lead.id,
          type: "stage",
          stage: "contacted",
          actor: "agent",
          note: "Auto-progressed stage from Matched to Contacted after outreach dispatch.",
        });
      }

      await recordUsage("Outreach Sent", 1, {
        leadId: existing.leadId,
        messageId: existing.id,
        channel: existing.channel,
      });

      void syncStateToNeo4j(getDomaine(), listLeads(), listMessages()).catch((err) => {
        console.warn("[api/messages] background Neo4j sync failed:", err);
      });
      addThought("writer", `Sent approved ${existing.channel} message ${existing.id} and queued graph update.`);

      return NextResponse.json({
        message: updated,
        messages: listMessages(),
        lead: getLead(existing.leadId),
      });
    }

    return NextResponse.json(
      { error: "Unsupported action. Use draft, approve, edit, reject, or send." },
      { status: 400 },
    );
  } catch (err) {
    console.error("[api/messages] POST error:", err);
    return NextResponse.json({ error: "Failed to process message request" }, { status: 500 });
  }
}
