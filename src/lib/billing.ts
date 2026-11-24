// Owner B. Temporary no-op stub created by A so /api/discover can call it.
// B: replace the body with Flexprice usage metering; keep the signature.

/** Records billable usage, e.g. trackUsage("leads_discovered", 8) or trackUsage("searches_run", 25). */
export async function trackUsage(event: string, quantity: number): Promise<void> {
  void event;
  void quantity;
}
