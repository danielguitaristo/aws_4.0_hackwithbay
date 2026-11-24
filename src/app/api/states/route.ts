// GET /api/states -> { counts: { CA: 1234, ... }, supported: ["CA", "NY", ...] } (owner C)
// Licensed importer companies per state from the TTB permit list, for the US map.
import { NextResponse } from "next/server";
import { importerCountsByState, REGIONS } from "@/lib/discovery";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ counts: importerCountsByState(), supported: Object.keys(REGIONS) });
  } catch (err) {
    console.error("[api/states]", err);
    return NextResponse.json({ counts: {}, supported: Object.keys(REGIONS) });
  }
}
