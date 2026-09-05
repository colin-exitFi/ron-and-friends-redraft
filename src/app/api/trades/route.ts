import { NextResponse } from "next/server";

import { proposeTrade, type ProposeTradeInput } from "@/lib/trades";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProposeTradeInput;
    const trade = await proposeTrade(body);
    return NextResponse.json({ trade });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
