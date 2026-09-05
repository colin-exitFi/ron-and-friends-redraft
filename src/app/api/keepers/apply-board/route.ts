import { NextResponse } from "next/server";

import { placeKeepersOnBoard, keeperTargetSeason } from "@/lib/keepers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const season =
      typeof body === "object" && body && "season" in body
        ? Number((body as { season?: number }).season)
        : keeperTargetSeason();
    const placed = await placeKeepersOnBoard(season);
    return NextResponse.json({ placed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
