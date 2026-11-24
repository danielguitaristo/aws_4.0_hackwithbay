import { NextResponse } from "next/server";
import { getBillingSnapshot, recordUsage, setDemoCredits, topUpCredits } from "@/lib/billing";

export async function GET() {
  try {
    const snapshot = await getBillingSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("[api/billing] GET error:", err);
    return NextResponse.json({ error: "Failed to load billing state" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: "topup" | "set_credits" | "track";
      amount?: number;
      event?: string;
      quantity?: number;
    };

    if (body.action === "topup") {
      const amount = typeof body.amount === "number" ? body.amount : 100;
      const snapshot = await topUpCredits(amount);
      return NextResponse.json(snapshot);
    }

    if (body.action === "set_credits") {
      const amount = typeof body.amount === "number" ? body.amount : 0;
      const snapshot = await setDemoCredits(amount);
      return NextResponse.json(snapshot);
    }

    if (body.action === "track" && body.event) {
      const quantity = typeof body.quantity === "number" ? body.quantity : 1;
      const snapshot = await recordUsage(body.event, quantity);
      return NextResponse.json(snapshot);
    }

    return NextResponse.json(
      { error: "Invalid action. Expected topup, set_credits, or track." },
      { status: 400 },
    );
  } catch (err) {
    console.error("[api/billing] POST error:", err);
    return NextResponse.json({ error: "Failed to process billing request" }, { status: 500 });
  }
}
