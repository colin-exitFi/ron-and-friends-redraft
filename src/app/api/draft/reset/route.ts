import { NextResponse } from "next/server";

import { resetDraft } from "@/lib/draft-service";

export const dynamic = "force-dynamic";

/**
 * Wipe every entered pick and start again. Keepers are untouched — they live in
 * the Smart Draft snapshot, not in the draft state.
 *
 * Guarded by an explicit confirmation string rather than a bare POST, because
 * this is the one button on the whole app that can destroy Saturday. The
 * pre-reset board is archived first — to `data/draft-backups/` or to
 * `draft_live_backups`, whichever store is live — so even this is recoverable.
 */
export async function POST(request: Request) {
  let confirm: unknown;
  try {
    ({ confirm } = (await request.json()) as { confirm?: unknown });
  } catch {
    confirm = undefined;
  }

  if (confirm !== "RESET") {
    return NextResponse.json(
      { ok: false, error: 'Send { "confirm": "RESET" } to clear the board.' },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ ok: true, view: await resetDraft() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
