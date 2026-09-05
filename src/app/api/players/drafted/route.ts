import { NextResponse } from "next/server";

import { readRoom } from "@/lib/draft-service";
import { draftedFromView } from "@/lib/cheat-sheet-view";

export const dynamic = "force-dynamic";

/**
 * Who is off the board, and nothing else.
 *
 * WHY THIS EXISTS WHEN `/api/draft/state` ALREADY DOES. The cheat sheet needs
 * exactly one fact — which players are gone and to whom — and it needs it again
 * after every single pick. The room view is the whole board: 150 slots, each
 * carrying two franchise records, and it weighs about 75KB. This is the same
 * information a phone actually uses, at roughly 4KB.
 *
 * That ratio is not a micro-optimisation, because of WHERE this runs. The draft
 * board is on a television on the venue's wifi and the people this endpoint
 * serves are on phones on the same wifi, re-fetching 150 times over the course
 * of an evening. The board's own re-sync can afford the full view — it needs the
 * whole thing and there is one of it. A pocketful of phones pulling the entire
 * board every ninety seconds is a different proposition.
 *
 * Same `readRoom()` underneath, so it cannot disagree with the board about who
 * has been drafted, and it fails in exactly the cases the board's own endpoint
 * would.
 */
export async function GET() {
  try {
    const view = await readRoom();
    return NextResponse.json({
      ok: true,
      drafted: draftedFromView(view),
      /** Lets a client show progress without a second call. */
      picksMade: view.picksMade,
      filled: view.filled,
      updatedAt: view.updatedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
