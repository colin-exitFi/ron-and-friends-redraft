import { NextResponse } from "next/server";

import { searchTradePlayers } from "@/lib/trade-player-search";

/**
 * Player matching for the trade log.
 *
 * Separate from `/api/players/search` on purpose. That route serves the draft
 * room and the `/players` table and runs on `player-search.ts`; this one runs on
 * the draft room's stronger matcher and annotates each hit with the franchise
 * the ledger says holds him. Kept apart so nothing on the draft's critical path
 * changes three days before the draft.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const pos = searchParams.get("pos");

  try {
    const players = await searchTradePlayers(q, { position: pos || null });
    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
