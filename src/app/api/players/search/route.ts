import { NextResponse } from "next/server";

import { searchPlayers } from "@/lib/player-search";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const pos = searchParams.get("pos") ?? undefined;
  const excludeDrafted = searchParams.get("excludeDrafted") === "1";

  try {
    const players = searchPlayers({ q, pos, excludeDrafted });
    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
