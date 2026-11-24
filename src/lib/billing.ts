import { addThought, getState, newId, saveState, type BillingLedgerEntry } from "./store";

const FLEXPRICE_CUSTOMER_EXTERNAL_ID = "winegtm_demo_estate";
const DEFAULT_FLEXPRICE_HOST = "https://us.api.flexprice.io/v1";

export type MeteredEventName =
  | "Leads Enriched"
  | "Outreach Sent"
  | "Graph Queries Evaluated"
  | "Leads Discovered"
  | "Searches Run";

interface EventRule {
  canonicalName: MeteredEventName;
  creditsPerUnit: number;
  usdPerUnit: number;
}

const EVENT_RULES: Record<string, EventRule> = {
  "Leads Enriched": { canonicalName: "Leads Enriched", creditsPerUnit: 5, usdPerUnit: 0.25 },
  leads_enriched: { canonicalName: "Leads Enriched", creditsPerUnit: 5, usdPerUnit: 0.25 },
  "Outreach Sent": { canonicalName: "Outreach Sent", creditsPerUnit: 2, usdPerUnit: 0.1 },
  outreach_sent: { canonicalName: "Outreach Sent", creditsPerUnit: 2, usdPerUnit: 0.1 },
  "Graph Queries Evaluated": { canonicalName: "Graph Queries Evaluated", creditsPerUnit: 1, usdPerUnit: 0.05 },
  graph_queries_evaluated: { canonicalName: "Graph Queries Evaluated", creditsPerUnit: 1, usdPerUnit: 0.05 },
  leads_discovered: { canonicalName: "Leads Discovered", creditsPerUnit: 1, usdPerUnit: 0.05 },
  searches_run: { canonicalName: "Searches Run", creditsPerUnit: 1, usdPerUnit: 0.02 },
};

export interface CreditCheckResult {
  allowed: boolean;
  creditsRemaining: number;
  creditsRequired: number;
  reason?: string;
}

export interface BillingSnapshot {
  provider: "flexprice" | "local";
  connected: boolean;
  customerExternalId: string;
  flexpriceCustomerId?: string;
  flexpriceWalletId?: string;
  creditsRemaining: number;
  startingCredits: number;
  creditsUsedTotal: number;
  totalCostUsd: number;
  enrichmentBlocked: boolean;
  breakdown: Record<string, { count: number; credits: number; costUsd: number }>;
  recentLedger: BillingLedgerEntry[];
}

function getFlexpriceConfig(): { apiKey: string; baseUrl: string } | null {
  const apiKey = process.env.FLEXPRICE_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.FLEXPRICE_API_HOST || DEFAULT_FLEXPRICE_HOST).replace(/\/$/, "");
  return { apiKey, baseUrl };
}

function resolveRule(event: string): EventRule {
  const matched = EVENT_RULES[event];
  if (matched) return matched;
  return {
    canonicalName: "Graph Queries Evaluated",
    creditsPerUnit: 1,
    usdPerUnit: 0.05,
  };
}

async function flexpriceRequest(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const config = getFlexpriceConfig();
  if (!config) {
    return { ok: false, status: 0, data: null };
  }

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        "x-api-key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    return { ok: response.ok, status: response.status, data: parsed };
  } catch (err) {
    console.warn("[billing] Flexprice request failed:", err);
    return { ok: false, status: 0, data: null };
  }
}

async function ensureFlexpriceCustomer(): Promise<string | undefined> {
  const state = getState();
  if (state.flexpriceCustomerId) {
    return state.flexpriceCustomerId;
  }

  const config = getFlexpriceConfig();
  if (!config) return undefined;

  const lookup = await flexpriceRequest(
    `/customers?external_id=${encodeURIComponent(FLEXPRICE_CUSTOMER_EXTERNAL_ID)}`,
    "GET",
  );

  if (lookup.ok && lookup.data && Array.isArray(lookup.data.items) && lookup.data.items.length > 0) {
    const first = lookup.data.items[0] as Record<string, unknown>;
    if (typeof first.id === "string") {
      state.flexpriceCustomerId = first.id;
      saveState(state);
      return first.id;
    }
  }

  const created = await flexpriceRequest("/customers", "POST", {
    external_id: FLEXPRICE_CUSTOMER_EXTERNAL_ID,
    name: state.domaine.name || "WineGTM Demo Estate",
    email: "export@domaine-petites-pierres.fr",
  });

  if (created.ok && created.data && typeof created.data.id === "string") {
    state.flexpriceCustomerId = created.data.id;
    saveState(state);
    return created.data.id;
  }

  return undefined;
}

async function ensureFlexpriceWallet(customerId: string): Promise<string | undefined> {
  const state = getState();
  if (state.flexpriceWalletId) {
    return state.flexpriceWalletId;
  }

  const walletsRes = await flexpriceRequest(
    `/wallets?customer_id=${encodeURIComponent(customerId)}`,
    "GET",
  );

  if (walletsRes.ok && walletsRes.data && Array.isArray(walletsRes.data.items) && walletsRes.data.items.length > 0) {
    const first = walletsRes.data.items[0] as Record<string, unknown>;
    if (typeof first.id === "string") {
      state.flexpriceWalletId = first.id;
      saveState(state);
      return first.id;
    }
  }

  const created = await flexpriceRequest("/wallets", "POST", {
    customer_id: customerId,
    name: "WineGTM Credits Wallet",
    type: "PREPAID",
    currency: "USD",
    initial_credits: state.startingCredits,
    conversion_rate: 1,
  });

  if (created.ok && created.data && typeof created.data.id === "string") {
    state.flexpriceWalletId = created.data.id;
    saveState(state);
    return created.data.id;
  }

  return undefined;
}

async function sendFlexpriceEvent(
  eventName: string,
  quantity: number,
  properties: Record<string, unknown>,
): Promise<boolean> {
  const config = getFlexpriceConfig();
  if (!config) return false;

  await ensureFlexpriceCustomer();

  const res = await flexpriceRequest("/events", "POST", {
    event_name: eventName,
    external_customer_id: FLEXPRICE_CUSTOMER_EXTERNAL_ID,
    event_id: newId("fp"),
    timestamp: new Date().toISOString(),
    source: "winegtm-backend",
    properties: {
      quantity,
      ...properties,
    },
  });

  return res.ok;
}

export function checkCredits(event: string, quantity = 1): CreditCheckResult {
  const state = getState();
  const rule = resolveRule(event);
  const creditsRequired = rule.creditsPerUnit * Math.max(1, quantity);

  if (state.creditsRemaining < creditsRequired) {
    return {
      allowed: false,
      creditsRemaining: state.creditsRemaining,
      creditsRequired,
      reason: `Insufficient credits: ${state.creditsRemaining} remaining, ${creditsRequired} required for ${rule.canonicalName}.`,
    };
  }

  return {
    allowed: true,
    creditsRemaining: state.creditsRemaining,
    creditsRequired,
  };
}

export async function recordUsage(
  event: string,
  quantity: number,
  metadata: Record<string, unknown> = {},
): Promise<BillingSnapshot> {
  const safeQuantity = Math.max(1, Math.round(quantity));
  const rule = resolveRule(event);
  const creditsUsed = rule.creditsPerUnit * safeQuantity;
  const costUsd = Number((rule.usdPerUnit * safeQuantity).toFixed(4));

  const state = getState();
  state.creditsRemaining = Math.max(0, state.creditsRemaining - creditsUsed);

  const synced = await sendFlexpriceEvent(rule.canonicalName, safeQuantity, {
    credits_used: creditsUsed,
    cost_usd: costUsd,
    ...metadata,
  });

  const leadId = typeof metadata.leadId === "string" ? metadata.leadId : undefined;
  const entry: BillingLedgerEntry = {
    id: newId("bill"),
    event: rule.canonicalName,
    quantity: safeQuantity,
    creditsUsed,
    costUsd,
    flexpriceSynced: synced,
    at: new Date().toISOString(),
    leadId,
  };

  state.billingLedger.unshift(entry);
  saveState(state);

  addThought(
    "billing",
    `Metered ${safeQuantity}x "${rule.canonicalName}" (-${creditsUsed} credits, $${costUsd.toFixed(2)}, ${synced ? "Flexprice synced" : "local ledger"}). Remaining: ${state.creditsRemaining}.`,
  );

  return getBillingSnapshot();
}

/**
 * Shared contract expected by Owner A (/api/discover) and Owner B routes.
 * Records billable usage to Flexprice and deducts credits from the active balance.
 */
export async function trackUsage(event: string, quantity: number): Promise<void> {
  await recordUsage(event, quantity);
}

export async function topUpCredits(amount: number): Promise<BillingSnapshot> {
  const safeAmount = Math.max(1, Math.round(amount));
  const state = getState();
  state.creditsRemaining += safeAmount;
  saveState(state);

  const customerId = await ensureFlexpriceCustomer();
  if (customerId) {
    const walletId = await ensureFlexpriceWallet(customerId);
    if (walletId) {
      await flexpriceRequest(`/wallets/${encodeURIComponent(walletId)}/top-up`, "POST", {
        amount: safeAmount,
        currency: "USD",
        description: "WineGTM demo credit top-up",
      });
    }
  }

  addThought("billing", `Topped up +${safeAmount} credits. Balance is now ${state.creditsRemaining}.`);
  return getBillingSnapshot();
}

export async function setDemoCredits(amount: number): Promise<BillingSnapshot> {
  const safeAmount = Math.max(0, Math.round(amount));
  const state = getState();
  state.creditsRemaining = safeAmount;
  saveState(state);

  addThought("billing", `Demo credit balance set to ${safeAmount}.`);
  return getBillingSnapshot();
}

export async function getBillingSnapshot(): Promise<BillingSnapshot> {
  const state = getState();
  const hasKey = Boolean(getFlexpriceConfig());

  if (hasKey && !state.flexpriceCustomerId) {
    const customerId = await ensureFlexpriceCustomer();
    if (customerId) {
      await ensureFlexpriceWallet(customerId);
    }
  }

  const breakdown: Record<string, { count: number; credits: number; costUsd: number }> = {};
  let creditsUsedTotal = 0;
  let totalCostUsd = 0;

  for (const item of state.billingLedger) {
    creditsUsedTotal += item.creditsUsed;
    totalCostUsd += item.costUsd;

    if (!breakdown[item.event]) {
      breakdown[item.event] = { count: 0, credits: 0, costUsd: 0 };
    }
    breakdown[item.event].count += item.quantity;
    breakdown[item.event].credits += item.creditsUsed;
    breakdown[item.event].costUsd = Number((breakdown[item.event].costUsd + item.costUsd).toFixed(4));
  }

  const enrichRule = resolveRule("Leads Enriched");

  return {
    provider: hasKey ? "flexprice" : "local",
    connected: hasKey,
    customerExternalId: FLEXPRICE_CUSTOMER_EXTERNAL_ID,
    flexpriceCustomerId: state.flexpriceCustomerId,
    flexpriceWalletId: state.flexpriceWalletId,
    creditsRemaining: state.creditsRemaining,
    startingCredits: state.startingCredits,
    creditsUsedTotal,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    enrichmentBlocked: state.creditsRemaining < enrichRule.creditsPerUnit,
    breakdown,
    recentLedger: state.billingLedger.slice(0, 25),
  };
}
