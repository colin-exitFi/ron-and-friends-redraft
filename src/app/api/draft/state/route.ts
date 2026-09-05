import { NextResponse } from "next/server";

import { readRoom } from "@/lib/draft-service";

export const dynamic = "force-dynamic";

/** The board as it stands. Used to re-sync a tab that fell behind. */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, view: await readRoom() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
