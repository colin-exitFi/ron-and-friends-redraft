import { NextResponse } from "next/server";

import { commitTrade } from "@/lib/trade-entry";
import type { TradeDraft } from "@/lib/trade-entry-types";

/**
 * Record a trade that has already happened in ESPN, and apply it to the ledger.
 *
 * Straight to `accepted`, because there is no approval left to model — the trade
 * was proposed, negotiated and approved on ESPN before it reached this app.
 * `commitTrade` re-runs the full preview server-side and refuses on any blocker,
 * so a client that skips the preview step cannot skip its checks.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const draft = (await request.json()) as TradeDraft;
    const result = await commitTrade(draft);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
