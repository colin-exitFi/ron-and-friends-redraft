import { NextResponse } from "next/server";

import { DraftRuleError } from "@/lib/draft-engine";
import { makePick, readRoom } from "@/lib/draft-service";

export const dynamic = "force-dynamic";

/**
 * Enter a pick. Body: `{ slotId, playerId, override? }`.
 *
 * A refused pick comes back 409 with `code` and `overridable`, plus the current
 * board so the screen corrects itself in the same round trip. `overridable`
 * means the board disagrees but will do it anyway if asked again with
 * `override: true` — the commissioner outranks the software.
 */
export async function POST(request: Request) {
  let body: { slotId?: unknown; playerId?: unknown; override?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }

  const { slotId, playerId, override } = body;
  if (typeof slotId !== "string" || typeof playerId !== "string") {
    return NextResponse.json(
      { ok: false, error: "Both slotId and playerId are required." },
      { status: 400 },
    );
  }

  try {
    const view = await makePick(slotId, playerId, { override: override === true });
    return NextResponse.json({ ok: true, view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (err instanceof DraftRuleError) {
      return NextResponse.json(
        {
          ok: false,
          error: message,
          code: err.code,
          overridable: err.overridable,
          view: await readRoom().catch(() => null),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
