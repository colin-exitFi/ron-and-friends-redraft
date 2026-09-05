import { NextResponse } from "next/server";

import { listTeamPickInventory } from "@/lib/trades";
import { CURRENT_SEASON } from "@/lib/league-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId");
  const season = Number(searchParams.get("season") ?? CURRENT_SEASON);
  if (!teamId) {
    return NextResponse.json({ error: "teamId required." }, { status: 400 });
  }
  try {
    const picks = await listTeamPickInventory(season, teamId);
    return NextResponse.json({ picks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
