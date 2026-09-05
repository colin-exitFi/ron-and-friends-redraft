import { NextResponse } from "next/server";

import { declareKeeper, listKeepers, removeKeeper, keeperTargetSeason } from "@/lib/keepers";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const season = Number(new URL(request.url).searchParams.get("season") ?? keeperTargetSeason());
  try {
    const keepers = await listKeepers(season);
    return NextResponse.json({ keepers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      season?: number;
      teamId?: string;
      playerId?: string;
      isUndrafted?: boolean;
      /** Round he occupied last season, when the rights ledger does not know. */
      basisRound?: number;
    };
    if (!body.teamId || !body.playerId) {
      return NextResponse.json({ error: "teamId and playerId required." }, { status: 400 });
    }
    const keeper = await declareKeeper({
      season: body.season ?? keeperTargetSeason(),
      teamId: body.teamId,
      playerId: body.playerId,
      isUndrafted: body.isUndrafted,
      basisRound: body.basisRound,
    });
    return NextResponse.json({ keeper });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
    await removeKeeper(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
