import { NextResponse } from "next/server";

import { getEligiblePlayers, keeperTargetSeason } from "@/lib/keepers";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId");
  const season = Number(searchParams.get("season") ?? keeperTargetSeason());
  if (!teamId) {
    return NextResponse.json({ error: "teamId required." }, { status: 400 });
  }
  try {
    const players = await getEligiblePlayers(teamId, season);
    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
