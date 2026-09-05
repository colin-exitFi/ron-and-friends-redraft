import { NextResponse } from "next/server";

import { acceptTrade, setTradeStatus } from "@/lib/trades";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { action?: "accept" | "veto" | "reverse" };
    if (body.action === "accept") {
      const trade = await acceptTrade(id);
      return NextResponse.json({ trade });
    }
    if (body.action === "veto" || body.action === "reverse") {
      await setTradeStatus(id, body.action === "veto" ? "vetoed" : "reversed");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action must be accept, veto, or reverse." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
