import { NextResponse } from "next/server";

import { CURRENT_SEASON } from "@/lib/league-config";
import { clearMockDraft, readMockDraft, writeMockDraft } from "@/lib/mock-draft-store";
import { isMockDraftFile } from "@/lib/mock-draft-types";

/**
 * Save, resume and discard a mock draft.
 *
 * Deliberately NOT under `/api/draft/**`. Those routes write Saturday's board;
 * these write `data/mock-draft-state-<season>.json` and nothing else. Keeping
 * them on a separate path means a mistyped URL in the mock client hits a 404
 * rather than the live draft.
 *
 * This route imports `@/lib/mock-draft-store` and NOTHING from
 * `@/lib/draft-store`, `@/lib/draft-service` or `@/lib/supabase`. It has no way
 * to reach the live board or the database — see the header of
 * `@/lib/mock-draft-store`, and `verify:mock`, which asserts the import graph.
 *
 * A mock never streams picks through here. The whole mock runs in the browser
 * against pure functions; this endpoint receives one complete snapshot at a
 * time, debounced. There is no per-pick request that could be aimed at the
 * wrong endpoint, because there is no per-pick request.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, state: readMockDraft(CURRENT_SEASON) });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body was not JSON." }, { status: 400 });
  }

  /*
   * Validated with the mock guard, which requires `kind` and `version:
   * "mock-1"`. Live draft state posted here would fail this check, which is the
   * point: the two file shapes are mutually unreadable by construction.
   */
  if (!isMockDraftFile(body)) {
    return NextResponse.json(
      { ok: false, error: "That is not a mock draft state file." },
      { status: 400 },
    );
  }

  if (body.season !== CURRENT_SEASON) {
    return NextResponse.json(
      { ok: false, error: `Mock is for season ${body.season}, not ${CURRENT_SEASON}.` },
      { status: 400 },
    );
  }

  try {
    writeMockDraft(body);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not save the mock." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  clearMockDraft(CURRENT_SEASON);
  return NextResponse.json({ ok: true });
}
