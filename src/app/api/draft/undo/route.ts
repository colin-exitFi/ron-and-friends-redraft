import { NextResponse } from "next/server";

import { DraftRuleError } from "@/lib/draft-engine";
import { clearSlot, readRoom, undoLastPick } from "@/lib/draft-service";

export const dynamic = "force-dynamic";

/**
 * Undo. With no body, unwinds the most recently ENTERED pick — which is not
 * necessarily the highest pick number, because the room drafts out of order.
 * With `{ slotId }`, clears that one slot instead, for a mis-entry noticed
 * several picks later.
 */
export async function POST(request: Request) {
  let slotId: string | null = null;
  try {
    const body = (await request.json()) as { slotId?: unknown };
    if (typeof body?.slotId === "string") slotId = body.slotId;
  } catch {
    // No body means "undo the last one", which is the common case.
  }

  try {
    const view = slotId ? await clearSlot(slotId) : await undoLastPick();
    return NextResponse.json({ ok: true, view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (err instanceof DraftRuleError) {
      return NextResponse.json(
        { ok: false, error: message, view: await readRoom().catch(() => null) },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
