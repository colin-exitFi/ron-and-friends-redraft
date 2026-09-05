import { NextResponse } from "next/server";

import { setOfficer } from "@/lib/governance";
import type { OfficerRole, OfficerStatus } from "@/lib/supabase/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      season?: number;
      role?: OfficerRole;
      teamId?: string | null;
      manager?: string | null;
      status?: OfficerStatus;
    };
    if (!body.role) {
      return NextResponse.json({ error: "role required." }, { status: 400 });
    }
    const view = await setOfficer({
      season: body.season,
      role: body.role,
      teamId: body.teamId ?? null,
      manager: body.manager ?? null,
      status: body.status,
    });
    return NextResponse.json({ governance: view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
