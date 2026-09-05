import { NextResponse } from "next/server";

import { previewTrade } from "@/lib/trade-entry";
import type { TradeDraft } from "@/lib/trade-entry-types";

/**
 * What a trade would do, computed against the live ledger and writing nothing.
 *
 * The commissioner confirms this rather than confirming the form he filled in,
 * which is the whole error-catching mechanism: a wrong entry reads wrong stated
 * as an outcome far more often than it reads wrong as a recap of the input.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const draft = (await request.json()) as TradeDraft;
    const preview = await previewTrade(draft);
    return NextResponse.json({ preview });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
