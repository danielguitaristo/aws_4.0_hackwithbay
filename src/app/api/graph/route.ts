import { NextResponse } from "next/server";
import type { Domaine, Lead } from "@/lib/types";
import { getDomaine, listLeads, listMessages, setDomaine, upsertLeads } from "@/lib/store";
import { queryGraphInsights } from "@/lib/graph";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const charge = url.searchParams.get("charge") !== "false";
    const insights = await queryGraphInsights(getDomaine(), listLeads(), listMessages(), charge);
    return NextResponse.json(insights);
  } catch (err) {
    console.error("[api/graph] GET error:", err);
    return NextResponse.json({ error: "Failed to query knowledge graph" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      domaine?: Domaine;
      leads?: Lead[];
      charge?: boolean;
    };

    if (body.domaine) {
      setDomaine(body.domaine);
    }
    if (Array.isArray(body.leads) && body.leads.length > 0) {
      upsertLeads(body.leads);
    }

    const insights = await queryGraphInsights(
      getDomaine(),
      listLeads(),
      listMessages(),
      body.charge !== false,
    );
    return NextResponse.json(insights);
  } catch (err) {
    console.error("[api/graph] POST error:", err);
    return NextResponse.json({ error: "Failed to update knowledge graph" }, { status: 500 });
  }
}
