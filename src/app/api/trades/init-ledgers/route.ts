import { NextResponse } from "next/server";

import { initializeLedgers } from "@/lib/trades";
import { CURRENT_SEASON } from "@/lib/league-config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const season =
      typeof body === "object" && body && "season" in body
        ? Number((body as { season?: number }).season)
        : CURRENT_SEASON;
    const result = await initializeLedgers(season);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
