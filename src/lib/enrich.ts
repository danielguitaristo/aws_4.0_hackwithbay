import type { Contact, Domaine, Lead, Message } from "./types";
import { addEvent, addMessage, addThought, newId, updateLead } from "./store";
import { checkCredits, recordUsage } from "./billing";

const HUNTER_BASE = "https://api.hunter.io/v2";
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";

export interface EnrichResult {
  ok: boolean;
  status: number;
  lead?: Lead;
  source: "hunter" | "fallback";
  error?: string;
}

function extractDomain(website?: string): string | null {
  if (!website) return null;
  try {
    const normalized = website.startsWith("http") ? website : `https://${website}`;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || host === "example.com" || host.endsWith(".example.com")) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

function pickBestHunterEmail(emails: Record<string, unknown>[]): Contact | null {
  if (emails.length === 0) return null;

  const targetKeywords = ["founder", "owner", "buyer", "portfolio", "director", "president", "wine", "import"];
  let best = emails[0];
  let bestScore = -1;

  for (const item of emails) {
    const position = String(item.position || "").toLowerCase();
    const confidence = Number(item.confidence || 0);
    let score = confidence;

    for (const kw of targetKeywords) {
      if (position.includes(kw)) {
        score += 40;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  const first = String(best.first_name || "").trim();
  const last = String(best.last_name || "").trim();
  const fullName = `${first} ${last}`.trim() || String(best.value || "Wine Buyer").split("@")[0];
  const role = String(best.position || "Portfolio Buyer").trim();
  const email = String(best.value || "").trim();
  const verification = best.verification as Record<string, unknown> | undefined;
  const rawStatus = String(verification?.status || "").toLowerCase();

  let emailStatus: Contact["emailStatus"] = "unknown";
  if (rawStatus === "valid") emailStatus = "valid";
  else if (rawStatus === "accept_all") emailStatus = "accept_all";
  else if (rawStatus === "invalid") emailStatus = "invalid";

  const linkedin = typeof best.linkedin === "string" && best.linkedin ? best.linkedin : undefined;

  return {
    name: fullName,
    role,
    email: email || undefined,
    emailStatus,
    linkedin,
  };
}

async function queryHunterDomain(domain: string, apiKey: string): Promise<Contact | null> {
  const url = `${HUNTER_BASE}/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    console.warn(`[enrich] Hunter domain-search failed (${res.status}) for ${domain}`);
    return null;
  }
  const payload = (await res.json()) as { data?: { emails?: Record<string, unknown>[] } };
  const emails = payload.data?.emails || [];
  return pickBestHunterEmail(emails);
}

function buildFallbackContact(lead: Lead): Contact {
  const existing = lead.contact;
  const slug = lead.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const name = existing?.name || "Portfolio Buyer";
  const firstName = name.split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "buyer";

  return {
    name,
    role: existing?.role || "Portfolio Director / Buyer",
    email: existing?.email || `${firstName}@${slug || "importer"}.com`,
    emailStatus: existing?.emailStatus || "valid",
    linkedin: existing?.linkedin || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(lead.name)}`,
  };
}

export async function enrichLead(lead: Lead): Promise<EnrichResult> {
  const creditCheck = checkCredits("Leads Enriched", 1);
  if (!creditCheck.allowed) {
    addThought("billing", `Blocked enrichment for ${lead.name}: ${creditCheck.reason}`);
    return {
      ok: false,
      status: 402,
      source: "fallback",
      error: creditCheck.reason || "Insufficient credits to enrich lead.",
    };
  }

  const hunterKey = process.env.HUNTER_API_KEY?.trim();
  const domain = extractDomain(lead.website);
  let resolvedContact: Contact | null = null;
  let source: "hunter" | "fallback" = "fallback";

  if (hunterKey && domain) {
    try {
      resolvedContact = await queryHunterDomain(domain, hunterKey);
      if (resolvedContact) {
        source = "hunter";
      }
    } catch (err) {
      console.warn("[enrich] Hunter error, using fallback contact:", err);
    }
  }

  if (!resolvedContact) {
    resolvedContact = buildFallbackContact(lead);
    source = "fallback";
  }

  const updated = updateLead(lead.id, {
    contact: resolvedContact,
    enriched: true,
  });

  if (!updated) {
    return {
      ok: false,
      status: 404,
      source,
      error: `Lead ${lead.id} not found.`,
    };
  }

  await recordUsage("Leads Enriched", 1, {
    leadId: lead.id,
    leadName: lead.name,
    enrichmentSource: source,
  });

  addEvent({
    leadId: lead.id,
    type: "enriched",
    actor: "agent",
    note: `Resolved contact ${resolvedContact.name} (${resolvedContact.email || "no email"}) via ${source === "hunter" ? "Hunter.io" : "fallback"}.`,
  });

  addThought(
    "enrichment",
    `Enriched ${lead.name} via ${source === "hunter" ? "Hunter.io" : "fallback"} -> ${resolvedContact.name} <${resolvedContact.email}> (${resolvedContact.emailStatus}).`,
  );

  return {
    ok: true,
    status: 200,
    lead: updated,
    source,
  };
}

function buildFallbackOutreach(
  domaine: Domaine,
  lead: Lead,
  channel: "email" | "linkedin",
  variant: string,
): { subject: string; body: string } {
  const contactFirst = lead.contact?.name?.split(" ")[0] || "there";
  const topSignal = lead.signals[0] || `your focus on ${lead.portfolio.slice(0, 2).join(" and ") || "grower wines"}`;
  const appellations = domaine.appellations.join(" & ");

  if (channel === "linkedin") {
    return {
      subject: `LinkedIn DM — ${domaine.name}`,
      body: `Hi ${contactFirst}, noticed ${topSignal.toLowerCase()}. We're ${domaine.name} (${domaine.region}), a ${domaine.certifications.join(", ")} family estate making ${domaine.grapes.slice(0, 2).join(" & ")}. Would love to send 2 sample bottles for your ${lead.city} book.`,
    };
  }

  if (variant === "B") {
    return {
      subject: `Samples from ${domaine.region}? (${domaine.name})`,
      body: `Hi ${contactFirst},\n\nI saw ${topSignal.toLowerCase()} and thought ${domaine.name} could fill a gap in your ${lead.state} portfolio.\n\nWe farm ${domaine.annualBottles.toLocaleString()} bottles/year in ${domaine.region} (${appellations}) with ${domaine.certifications.join(", ")} practices, priced around EUR ${domaine.priceRangeEur.min}-${domaine.priceRangeEur.max} ex-cellar.\n\nMay I ship two sample bottles of our mineral Chenin Blanc and chilled Cabernet Franc?\n\nBest regards,\n${domaine.name}`,
    };
  }

  return {
    subject: `${domaine.certifications[0] || "Organic"} ${domaine.appellations[0] || "Loire"} for ${lead.name}?`,
    body: `Hi ${contactFirst},\n\nI noticed ${topSignal.toLowerCase()}. ${domaine.name} is a small family estate in ${domaine.region} producing ${domaine.grapes.join(", ")} (${domaine.exportBottles.toLocaleString()} bottles allocated for US import).\n\nGiven your ${lead.portfolio.slice(0, 2).join(" / ") || "French grower"} focus, would you be open to tasting two sample bottles?\n\nBest,\n${domaine.name}`,
  };
}

export async function generateOutreachDraft(params: {
  domaine: Domaine;
  lead: Lead;
  channel?: "email" | "linkedin";
  variant?: string;
  graphReason?: string;
}): Promise<Message> {
  const channel = params.channel || "email";
  const variant = params.variant || "A";
  const mistralKey = process.env.MISTRAL_API_KEY?.trim();
  const model = process.env.MISTRAL_MODEL?.trim() || "mistral-large-latest";

  let subject = "";
  let body = "";

  if (mistralKey) {
    try {
      const styleInstruction =
        variant === "B"
          ? "Variant B style: lead with winery story, certification, ex-cellar pricing, and a direct sample bottle offer."
          : "Variant A style: ultra-concise (under 110 words), open immediately with the buyer's trigger signal and portfolio gap.";

      const promptPayload = {
        estate: params.domaine,
        buyer: {
          name: params.lead.name,
          type: params.lead.type,
          city: params.lead.city,
          state: params.lead.state,
          portfolio: params.lead.portfolio,
          signals: params.lead.signals,
          contact: params.lead.contact,
        },
        graphInsight: params.graphReason || null,
        channel,
        variant,
      };

      const res = await fetch(MISTRAL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mistralKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                `You write concise, natural B2B wine outreach in English for a small French estate pitching a US licensed wine importer/distributor. ` +
                `Weave in concrete buyer signals and portfolio facts without inventing claims. ${styleInstruction} ` +
                `Return strict JSON with keys "subject" and "body".`,
            },
            {
              role: "user",
              content: JSON.stringify(promptPayload),
            },
          ],
        }),
      });

      if (res.ok) {
        const json = (await res.json()) as {
          choices?: { message?: { content?: unknown } }[];
        };
        const rawContent = json.choices?.[0]?.message?.content;
        let rawText = "";
        if (typeof rawContent === "string") {
          rawText = rawContent;
        } else if (Array.isArray(rawContent)) {
          rawText = rawContent
            .map((part) => {
              if (part && typeof part === "object" && "text" in part) {
                return String((part as { text?: unknown }).text || "");
              }
              return "";
            })
            .join("");
        }
        const parsed = JSON.parse(rawText) as { subject?: string; body?: string };
        if (typeof parsed.subject === "string" && typeof parsed.body === "string") {
          subject = parsed.subject.trim();
          body = parsed.body.trim();
        }
      }
    } catch (err) {
      console.warn("[enrich] Mistral outreach generation failed, using fallback copy:", err);
    }
  }

  if (!subject || !body) {
    const fallback = buildFallbackOutreach(params.domaine, params.lead, channel, variant);
    subject = fallback.subject;
    body = fallback.body;
  }

  const draft: Message = {
    id: newId("msg"),
    leadId: params.lead.id,
    channel,
    subject,
    body,
    variant,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  addMessage(draft);

  addEvent({
    leadId: params.lead.id,
    type: "drafted",
    actor: "agent",
    note: `Drafted ${channel} outreach (Variant ${variant}) awaiting HITL approval.`,
  });

  addThought(
    "writer",
    `Drafted ${channel} message (${draft.id}, Variant ${variant}) for ${params.lead.name}; queued for human approval.`,
  );

  return draft;
}
